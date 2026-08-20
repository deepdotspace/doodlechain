/**
 * App Worker — Hono-based Cloudflare Worker for DeepSpace apps.
 *
 * Each app owns its RecordRoom DOs. Schemas are baked in at deploy time.
 *
 * Handles:
 *   - WebSocket → app's own RecordRoom DO (real-time data)
 *   - Auth proxy → auth-worker (same-origin cookies)
 *   - Integration proxy → api-worker (LLM, search, etc.)
 *   - AI chat (Vercel AI SDK + DeepSpace proxy)
 *   - Server actions (app-defined, bypass user RBAC)
 *   - Scoped R2 file storage
 *   - HMAC-authenticated cron
 *   - Static asset serving with SPA fallback
 */

import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { verifyJwt, apiWorkerFetch, platformWorkerFetch, authWorkerFetch } from 'deepspace/worker'
import {
  ANONYMOUS_USER_ID_PREFIX,
  authenticatedRoomRequest,
  resolveAppRole as sdkResolveAppRole,
} from 'deepspace/worker'
import type { JwtVerifierConfig, VerifyResult } from 'deepspace/worker'
import { RecordRoom, YjsRoom, CanvasRoom, PresenceRoom, CronRoom, JobRoom } from 'deepspace/worker'
import type { Job, JobContext, ActionTools, ActionResult, DOManifest, DOBindings } from 'deepspace/worker'
// GameRoom left the SDK in v0.17.0 with no replacement, so the app owns it now.
// The vendored copy is the 0.9.2 implementation on top of the still-public
// BaseRoom; the wire format and the `game_state` table are byte-for-byte the
// same, so already-persisted rooms and deployed clients keep working.
import { GameRoom } from './src/vendor/deepspace-game/game-room.js'
import type { GameInput } from './src/vendor/deepspace-game/game-room.js'
import { actions } from './src/actions/index.js'
import { tasks as cronTasks, runTask as runCronTask } from './src/cron.js'
import { runJob } from './src/jobs.js'
import { schemas } from './src/schemas.js'
import { integrations } from './src/integrations.js'
import { reduce, createInitialState } from './src/game/engine.js'
import { STATE_VERSION } from './src/game/types.js'
import type { EngineInput, GameState, PlayerState, RosterEntry } from './src/game/types.js'
import { MAX_PLAYERS } from './src/game/config.js'
import { BOT_THINK_MS, botGuess, botPrompt, botTurn, strHash } from './src/game/bots.js'
import type { BotTurn } from './src/game/bots.js'
import { botDoodle } from './src/game/doodles.js'

// =============================================================================
// Role resolution
// =============================================================================

/**
 * The SDK's `resolveAppRole()` addresses the RecordRoom as
 * `app:${DEEPSPACE_APP_ID}`. This app's room — the one holding the `users` rows
 * this reads — is keyed `app:${APP_NAME}` (SCOPE_ID in src/constants.ts), which
 * is what the client mounts RecordScope on and what every `idFromName` below
 * uses. Hand the helper the name the room is actually stored under.
 *
 * Every call site must go through this wrapper, never the raw export: a bare
 * call reads an empty Durable Object and returns 'viewer' for everyone but the
 * owner. Shadowing the imported name is deliberate — it makes the raw export
 * unreachable from any call site in this file.
 */
function resolveAppRole(env: Env, userId: string) {
  return sdkResolveAppRole(
    {
      RECORD_ROOMS: env.RECORD_ROOMS,
      DEEPSPACE_APP_ID: env.APP_NAME,
      OWNER_USER_ID: env.OWNER_USER_ID,
    },
    userId,
  )
}

// =============================================================================
// DO Manifest — declares all Durable Objects for dynamic deploy bindings
// =============================================================================

export const __DO_MANIFEST__ = [
  { binding: 'RECORD_ROOMS', className: 'AppRecordRoom', sqlite: true },
  { binding: 'YJS_ROOMS', className: 'AppYjsRoom', sqlite: true },
  { binding: 'CANVAS_ROOMS', className: 'AppCanvasRoom', sqlite: true },
  { binding: 'PRESENCE_ROOMS', className: 'AppPresenceRoom', sqlite: true },
  { binding: 'CRON_ROOMS', className: 'AppCronRoom', sqlite: true },
  { binding: 'JOB_ROOMS', className: 'AppJobRoom', sqlite: true },
  { binding: 'GAME_ROOMS', className: 'AppGameRoom', sqlite: true },
] as const satisfies DOManifest

// =============================================================================
// Durable Objects — extend to customize behavior
// =============================================================================

export class AppRecordRoom extends RecordRoom<Env> {
  constructor(state: DurableObjectState, env: Env) {
    super(state, env, schemas, { ownerUserId: env.OWNER_USER_ID })
  }
}

export class AppYjsRoom extends YjsRoom<Env> {}
export class AppCanvasRoom extends CanvasRoom<Env> {}
export class AppPresenceRoom extends PresenceRoom<Env> {}

/**
 * AppCronRoom — runs scheduled tasks defined in src/cron.ts.
 *
 * Tasks are configured at construction time. The DO alarm fires at the
 * next interval / cron-expression match, calls `onTask(name)`, and
 * records the execution in its `cron_history` table. Admin clients can
 * watch via the `useCronMonitor('app:<APP_NAME>')` hook.
 */
export class AppCronRoom extends CronRoom<Env> {
  constructor(state: DurableObjectState, env: Env) {
    super(state, env, { tasks: cronTasks })
  }

  protected async onTask(taskName: string): Promise<void> {
    await runCronTask(taskName, this.env)
  }
}

/**
 * AppJobRoom — durable background-job queue defined in src/jobs.ts.
 *
 * Use this for any work that needs to outlive an HTTP response: AI
 * generation, exports, renders, scheduled side effects. The DO alarm
 * picks up queued jobs and calls `onJob(job, ctx)`; crashes mid-run are
 * recovered automatically. Clients enqueue and subscribe via the
 * `useJobs('app:<APP_NAME>')` hook; server-side code uses the
 * `enqueueJob` helper from 'deepspace/worker'.
 */
export class AppJobRoom extends JobRoom<Env> {
  constructor(state: DurableObjectState, env: Env) {
    super(state, env, {
      authorizeWrite: async (user) => {
        if (user.userId.startsWith('anon-')) return false
        const role = await resolveAppRole(env, user.userId)
        return role === 'member' || role === 'admin'
      },
    })
  }

  protected async onJob(job: Job, ctx: JobContext): Promise<unknown> {
    return await runJob(job, ctx, this.env)
  }
}

/**
 * AppGameRoom — the Doodle Chain game loop. All game logic lives in the pure,
 * unit-tested reducer in `src/game/engine.ts`; this DO is thin glue: each tick
 * it hands the SDK's connected-player roster + buffered inputs to `reduce` and
 * persists/broadcasts whatever it returns (or nothing, on an idle tick).
 *
 * Phase advancement is SERVER-AUTHORITATIVE: the tick loop runs in the DO
 * (driven by its own alarm), so timers fire and rounds advance even if every
 * client tab closes. There is no host-tab dependency.
 *
 * It also DRIVES the bots. Bots draw by serving a real human doodle that matches
 * the prompt (see doodles.ts), and write/guess from canned lists — all pure,
 * synchronous, and offline. So bot moves are computed right here in onTick and
 * reduced in the same pass as the humans' inputs: no async, no staging, nothing
 * to bill. The only guard is "at least one connected human", so a stray room
 * can't sit playing itself forever.
 */
export class AppGameRoom extends GameRoom<Env> {
  constructor(state: DurableObjectState, env: Env) {
    super(state, env, { tickRate: 2, minPlayers: 1, maxPlayers: MAX_PLAYERS })
  }

  protected onTick(
    state: Record<string, unknown>,
    inputs: GameInput[],
    _tick: number,
  ): Record<string, unknown> | undefined {
    const roster: RosterEntry[] = this.getPlayers().map((p) => ({
      userId: p.userId,
      userName: p.userName,
    }))
    const now = Date.now()
    const cur = this.coerce(state)
    // Bots move synchronously in the same tick as the humans: their inputs are
    // computed from the current state and reduced alongside the buffered human
    // inputs. A bot and a human never own the same chain step, so order is moot.
    const human = inputs as unknown as EngineInput[]
    const bots = this.botInputs(cur, now)
    const merged = bots.length > 0 ? [...bots, ...human] : human
    const next = reduce(cur, merged, now, roster)
    return (next ?? undefined) as Record<string, unknown> | undefined
  }

  protected onHydrateState(stored: Record<string, unknown>): Record<string, unknown> {
    return this.coerce(stored) as unknown as Record<string, unknown>
  }

  /** Treat an empty / stale-version blob as a fresh game. */
  private coerce(raw: Record<string, unknown>): GameState {
    if (raw && typeof raw === 'object' && (raw as Partial<GameState>).v === STATE_VERSION) {
      return raw as unknown as GameState
    }
    return createInitialState()
  }

  // ---------------------------------------------------------------------------
  // Bot driver — pure, synchronous, offline
  // ---------------------------------------------------------------------------

  /**
   * The bot moves due this tick, as ordinary engine inputs. A bot acts only
   * after a short "thinking" beat (so humans see the phase first, staggered so
   * bots don't all fire at once) and only if at least one human is connected.
   * `botTurn` returns null once a bot has submitted, so it's never added twice.
   */
  private botInputs(cur: GameState, now: number): EngineInput[] {
    if (cur.phase !== 'PROMPT' && cur.phase !== 'DRAW' && cur.phase !== 'GUESS') return []
    if (cur.phaseEndsAt === null) return []
    const bots = Object.values(cur.players).filter((p) => p.isBot)
    if (bots.length === 0) return []
    // Never let a room play itself with no human present.
    if (!Object.values(cur.players).some((p) => !p.isBot && p.connected)) return []

    const phaseStart = cur.phaseEndsAt - phaseDurationMs(cur)
    const out: EngineInput[] = []
    for (const bot of bots) {
      const turn = botTurn(cur, bot)
      if (!turn) continue
      if (now < phaseStart + BOT_THINK_MS + (strHash(bot.userId) % 2000)) continue
      out.push(this.botInput(bot, turn))
    }
    return out
  }

  /** One bot's move: a real doodle matching the prompt to draw, else a canned line. */
  private botInput(bot: PlayerState, turn: BotTurn): EngineInput {
    const seed = strHash(`${bot.userId}:${turn.round}`)
    switch (turn.phase) {
      case 'DRAW':
        return { userId: bot.userId, action: 'SUBMIT_DRAWING', data: { strokes: botDoodle(turn.source, seed) } }
      case 'GUESS':
        return { userId: bot.userId, action: 'SUBMIT_GUESS', data: { text: botGuess(strHash(`${bot.userId}:g:${turn.round}`)) } }
      default:
        return { userId: bot.userId, action: 'SUBMIT_PROMPT', data: { text: botPrompt(seed) } }
    }
  }
}

function phaseDurationMs(s: GameState): number {
  switch (s.phase) {
    case 'PROMPT':
      return s.config.promptSeconds * 1000
    case 'DRAW':
      return s.config.drawSeconds * 1000
    case 'GUESS':
      return s.config.guessSeconds * 1000
    default:
      return 0
  }
}

// =============================================================================
// Types
// =============================================================================

export interface Env extends DOBindings<typeof __DO_MANIFEST__> {
  ASSETS: Fetcher
  /**
   * Upstream platform-worker. In production this is a [[services]] binding;
   * in `deepspace dev` the binding is absent and the helper falls back to
   * `PLATFORM_WORKER_URL` (written into .dev.vars by the CLI).
   *
   * R2 lives on the platform side, not the app: the `/api/files/*` route
   * below proxies to platform-worker `/internal/files/*` which serves a
   * shared `APP_FILES` bucket scoped per-app via the `?scope=` query:
   *   - `?scope=app`  → apps/<APP_NAME>/…       (per-app shared)
   *   - `?scope=self` → apps/<APP_NAME>/users/<userId>/…  (per-user, default)
   *
   * Apps don't need a local R2 binding for the standard flow. If you need
   * a wholly separate bucket, add `[[r2_buckets]]` to wrangler.toml AND a
   * field here — but prefer the proxied path so the platform retains
   * unified moderation / quota / cleanup hooks.
   */
  PLATFORM_WORKER?: Fetcher
  PLATFORM_WORKER_URL?: string
  APP_IDENTITY_TOKEN: string
  /**
   * Upstream api-worker. Same pattern as PLATFORM_WORKER above —
   * binding in prod, URL fallback in dev.
   */
  API_WORKER?: Fetcher
  API_WORKER_URL?: string
  AUTH_JWT_PUBLIC_KEY: string
  AUTH_JWT_ISSUER: string
  AUTH_WORKER_URL: string
  APP_NAME: string
  DEEPSPACE_APP_ID: string
  OWNER_USER_ID: string
  /**
   * Long-lived JWT minted for the app owner at deploy time. Server-side
   * code (actions, cron, AI helpers) uses this to authenticate to the
   * api-worker for developer-billed calls — the owner is billed because
   * they are the JWT subject.
   */
  APP_OWNER_JWT: string
  /**
   * When set to "true", the app worker exposes /api/debug/* (set-role,
   * sql, query, records, status) by forwarding to the RecordRoom DO's
   * debug handler. Tests need this for role elevation and state cleanup.
   *
   * The CLI writes this to .dev.vars on `deepspace dev`/`deepspace test`
   * but never to production secrets, so deployed apps don't expose
   * debug routes by default.
   */
  ALLOW_DEBUG_ROUTES?: string
}

export type AppContext = { Bindings: Env }

// =============================================================================
// App
// =============================================================================

const app = new Hono<AppContext>()
app.use('/api/*', cors())

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

function jwtConfig(env: Env): JwtVerifierConfig {
  return { publicKey: env.AUTH_JWT_PUBLIC_KEY, issuer: env.AUTH_JWT_ISSUER }
}

async function resolveAuth(req: Request, env: Env): Promise<VerifyResult | null> {
  const header = req.headers.get('Authorization')
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null
  if (!token) return null
  return (await verifyJwt(jwtConfig(env), token)).result
}

// ---------------------------------------------------------------------------
// Social OAuth redirect + code exchange
// ---------------------------------------------------------------------------

app.get('/api/auth/social-redirect', (c) => {
  const provider = c.req.query('provider')
  if (!provider) return c.json({ error: 'Missing provider' }, 400)

  const appOrigin = new URL(c.req.url).origin
  const authOrigin = new URL(c.env.AUTH_WORKER_URL).origin

  return c.redirect(
    `${authOrigin}/login/social?provider=${encodeURIComponent(provider)}&returnTo=${encodeURIComponent(appOrigin)}`,
  )
})

app.get('/api/auth/oauth-complete', async (c) => {
  const code = c.req.query('code')
  const appOrigin = new URL(c.req.url).origin

  if (!code) return c.redirect(appOrigin)

  const res = await authWorkerFetch(c.env, '/api/auth/exchange-code', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  })

  if (!res.ok) return c.redirect(appOrigin)
  const data = (await res.json()) as { sessionToken?: string }
  if (!data.sessionToken) return c.redirect(appOrigin)
  const sessionToken = data.sessionToken

  return new Response(null, {
    status: 302,
    headers: {
      Location: appOrigin,
      'Set-Cookie': `__Secure-better-auth.session_token=${encodeURIComponent(sessionToken)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`,
    },
  })
})

app.all('/api/auth/sign-out', async (c) => {
  try {
    await authWorkerFetch(c.env, '/api/auth/sign-out', {
      method: c.req.method,
      headers: c.req.raw.headers,
      body: c.req.method !== 'GET' && c.req.method !== 'HEAD' ? c.req.raw.body : undefined,
    })
  } catch {
    // Still expire the app-scoped cookie below. A network/auth-worker
    // failure must not leave the browser immediately signed back in.
  }

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': '__Secure-better-auth.session_token=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0',
    },
  })
})

// ---------------------------------------------------------------------------
// Auth proxy → auth-worker (same-origin cookies)
// ---------------------------------------------------------------------------

app.all('/api/auth/*', async (c) => {
  const url = new URL(c.req.url)
  const res = await authWorkerFetch(c.env, url.pathname + url.search, {
    method: c.req.method,
    headers: c.req.raw.headers,
    body: c.req.method !== 'GET' && c.req.method !== 'HEAD' ? c.req.raw.body : undefined,
  })
  const headers = new Headers(res.headers)
  const setCookie = headers.get('set-cookie')
  if (setCookie) {
    headers.set('set-cookie', setCookie.replace(/;\s*Domain=[^;]*/gi, ''))
  }
  return new Response(res.body, { status: res.status, headers })
})

// ---------------------------------------------------------------------------
// Debug proxy → app's RecordRoom DO
//
// Forwards /api/debug/* (set-role, sql, query, records, user-role, status)
// to the DO's debug handler. The DO ships these endpoints unconditionally,
// so we gate the proxy on env.ALLOW_DEBUG_ROUTES === "true". The CLI
// writes that env var to the SDK-managed section of .dev.vars on
// `deepspace dev`/`deepspace test`, which is stripped on deploy —
// production apps return 404 here by default.
//
// To opt /api/debug/* INTO production (admin scripts, one-off cleanup,
// staging environments), set `ALLOW_DEBUG_ROUTES=true` in the USER
// section of .dev.vars (below the `# --- not managed by the SDK ---`
// divider). The CLI ships user-section values as secret_text bindings,
// so it lands in env.ALLOW_DEBUG_ROUTES on the deployed worker.
// The DO's debug handler has NO auth of its own — it trusts whatever
// reaches it — so this proxy is the gate: the caller must present a
// valid JWT and hold the `admin` app role. Turn the flag on deliberately
// even so; an admin here can read and mutate any record.
// ---------------------------------------------------------------------------

app.all('/api/debug/*', async (c) => {
  if (c.env.ALLOW_DEBUG_ROUTES !== 'true') {
    return c.notFound()
  }
  const auth = await resolveAuth(c.req.raw, c.env)
  if (!auth) return c.json({ error: 'unauthorized' }, 401)
  if ((await resolveAppRole(c.env, auth.userId)) !== 'admin') {
    return c.json({ error: 'forbidden' }, 403)
  }
  const stub = c.env.RECORD_ROOMS.get(c.env.RECORD_ROOMS.idFromName(`app:${c.env.APP_NAME}`))
  // Forward verbatim, preserving method, headers, body, and the full URL
  // (the DO's debug handler dispatches on url.pathname).
  return stub.fetch(c.req.raw)
})

// ---------------------------------------------------------------------------
// Integrations proxy → api-worker
// ---------------------------------------------------------------------------

app.get('/api/integrations', async (c) => {
  try {
    const res = await apiWorkerFetch(c.env, '/api/integrations')
    return new Response(res.body, { status: res.status, headers: res.headers })
  } catch {
    return c.json({ error: 'Failed to fetch integration catalog' }, 502)
  }
})

// OAuth: per-user connection status. Always user-billed — must forward caller's JWT.
app.get('/api/integrations/status', async (c) => {
  const auth = await resolveAuth(c.req.raw, c.env)
  if (!auth) return c.json({ error: 'Sign in required' }, 401)
  const token = c.req.header('Authorization')?.slice(7)
  try {
    const res = await apiWorkerFetch(c.env, '/api/integrations/status', {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
    return new Response(res.body, { status: res.status, headers: res.headers })
  } catch {
    return c.json({ error: 'Status proxy failed' }, 502)
  }
})

// OAuth: disconnect a provider for the calling user. Always user-billed.
app.delete('/api/integrations/oauth/:provider/disconnect', async (c) => {
  const auth = await resolveAuth(c.req.raw, c.env)
  if (!auth) return c.json({ error: 'Sign in required' }, 401)
  const token = c.req.header('Authorization')?.slice(7)
  const provider = c.req.param('provider')
  try {
    const res = await apiWorkerFetch(
      c.env,
      `/api/integrations/oauth/${encodeURIComponent(provider)}/disconnect`,
      {
        method: 'DELETE',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      },
    )
    return new Response(res.body, { status: res.status, headers: res.headers })
  } catch {
    return c.json({ error: 'Disconnect proxy failed' }, 502)
  }
})

app.all('/api/integrations/:name/:endpoint', async (c) => {
  const integrationName = c.req.param('name')
  const billingMode = integrations[integrationName]?.billing ?? 'developer'

  const auth = await resolveAuth(c.req.raw, c.env)
  if (!auth && billingMode === 'user') {
    return c.json({ error: 'Sign in required for this integration' }, 401)
  }

  const target = `/api/integrations/${integrationName}/${c.req.param('endpoint')}`

  const headers: Record<string, string> = {
    'Content-Type': c.req.header('Content-Type') ?? 'application/json',
  }

  // Pick the JWT whose subject is the user we want billed:
  //   - developer-billed → the app owner (via APP_OWNER_JWT)
  //   - user-billed      → the caller (forward their Bearer token)
  // The api-worker bills the JWT subject; it does not accept any
  // client-supplied billing override.
  if (billingMode === 'developer') {
    headers['Authorization'] = `Bearer ${c.env.APP_OWNER_JWT}`
  } else {
    const token = c.req.header('Authorization')?.slice(7)
    if (token) headers['Authorization'] = `Bearer ${token}`
  }

  const hasBody = c.req.method !== 'GET' && c.req.method !== 'HEAD'
  const body = hasBody ? await c.req.text() : undefined

  try {
    const res = await apiWorkerFetch(c.env, target, {
      method: c.req.method,
      headers,
      body,
    })
    return new Response(res.body, { status: res.status, headers: res.headers })
  } catch {
    return c.json({ error: 'Integration proxy failed' }, 502)
  }
})

// ---------------------------------------------------------------------------
// WebSocket routes
// ---------------------------------------------------------------------------

// The DO reads identity (userId, userName, userEmail, userImageUrl, role) from
// verified request HEADERS, never from the URL. `authenticatedRoomRequest`
// strips the caller's `token`, every legacy identity query param and every
// inbound identity header before writing the verified ones, so a client can
// spoof neither channel. Three states: no token = anonymous (the SDK's
// allowAnonymous flow), invalid token = 401, valid token = JWT identity.
function wsRoute(
  doNamespace: (env: Env) => DurableObjectNamespace,
  extraIdentity?: (auth: VerifyResult, env: Env) => { role?: string } | Promise<{ role?: string }>,
) {
  return async (c: any) => {
    const id = c.req.param('roomId') ?? c.req.param('docId') ?? c.req.param('scopeId')
    if (!id) return new Response('Not found', { status: 404 })
    const token = new URL(c.req.url).searchParams.get('token')

    let auth: VerifyResult | null = null
    if (token) {
      auth = (await verifyJwt(jwtConfig(c.env), token)).result
      if (!auth) return new Response('Unauthorized', { status: 401 })
    }

    const roomRequest = authenticatedRoomRequest(
      c.req.raw,
      auth,
      auth ? await extraIdentity?.(auth, c.env) : undefined,
    )
    const ns = doNamespace(c.env)
    const stub = ns.get(ns.idFromName(id))
    return stub.fetch(roomRequest)
  }
}

app.get(
  '/ws/:roomId',
  wsRoute((env) => env.RECORD_ROOMS),
)

type DocsYjsRole = 'admin' | 'member' | 'viewer'

interface DocumentRecordForAccess {
  ownerId?: string
  collaborators?: string
  editors?: string
}

type DocumentAccessLookup =
  | { kind: 'found'; doc: DocumentRecordForAccess }
  | { kind: 'not-docs-room' }
  | { kind: 'error' }

function parseAccessList(raw: string | undefined): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

async function getDocumentForAccess(
  env: Env,
  docId: string,
): Promise<DocumentAccessLookup> {
  const stub = env.RECORD_ROOMS.get(env.RECORD_ROOMS.idFromName(`app:${env.APP_NAME}`))
  try {
    const res = await stub.fetch(
      new Request('https://internal/api/tools/execute', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': env.OWNER_USER_ID,
          'X-App-Action': 'true',
        },
        body: JSON.stringify({
          tool: 'records.get',
          params: { collection: 'documents', recordId: docId },
        }),
      }),
    )
    const json = (await res.json()) as {
      success?: boolean
      error?: string
      data?: { record?: { data?: DocumentRecordForAccess } }
    }
    if (json.success && json.data?.record?.data) {
      return { kind: 'found', doc: json.data.record.data }
    }
    if (
      json.error === 'Record not found' ||
      json.error?.startsWith('Schema not registered for collection: documents')
    ) {
      return { kind: 'not-docs-room' }
    }
    return { kind: 'error' }
  } catch {
    return { kind: 'error' }
  }
}

async function resolveDocsYjsRole(
  env: Env,
  docId: string,
  userId: string,
): Promise<DocsYjsRole | null> {
  const lookup = await getDocumentForAccess(env, docId)
  if (lookup.kind === 'not-docs-room') return 'member'
  if (lookup.kind === 'error') return null
  const { doc } = lookup
  if (doc.ownerId === userId || userId === env.OWNER_USER_ID) return 'admin'

  const editors = parseAccessList(doc.editors)
  if (editors.includes(userId)) return 'member'

  const collaborators = parseAccessList(doc.collaborators)
  if (collaborators.includes(userId)) return 'viewer'

  return null
}

app.get('/ws/yjs/:docId', async (c) => {
  const docId = c.req.param('docId')
  const url = new URL(c.req.url)
  const token = url.searchParams.get('token')
  const auth = token ? (await verifyJwt(jwtConfig(c.env), token)).result : null
  if (!auth) return new Response('Unauthorized', { status: 401 })

  const role = await resolveDocsYjsRole(c.env, docId, auth.userId)
  if (!role) return new Response('Forbidden', { status: 403 })

  const stub = c.env.YJS_ROOMS.get(c.env.YJS_ROOMS.idFromName(docId))
  return stub.fetch(authenticatedRoomRequest(c.req.raw, auth, { role }))
})

app.get(
  '/ws/canvas/:docId',
  wsRoute(
    (env) => env.CANVAS_ROOMS,
    async (auth, env) => ({ role: await resolveAppRole(env, auth.userId) }),
  ),
)

// No extra identity: name and avatar already ride the verified headers, and
// v0.19.0 dropped email and avatar from ephemeral presence entirely.
app.get(
  '/ws/presence/:scopeId',
  wsRoute((env) => env.PRESENCE_ROOMS),
)

app.get(
  '/ws/cron/:roomId',
  wsRoute(
    (env) => env.CRON_ROOMS,
    // Write access (trigger / pause / resume) follows the caller's real app
    // role, not a constant. Anonymous connections carry no role and become
    // viewers, which CronRoom enforces as read-only. Apps that want stricter
    // access (e.g. owner-only) should replace this with an inline handler —
    // see the /ws/yjs route for the pattern.
    async (auth, env) => ({ role: await resolveAppRole(env, auth.userId) }),
  ),
)

app.get(
  '/ws/jobs/:roomId',
  wsRoute((env) => env.JOB_ROOMS),
)

// Game rooms — party-game model: anyone holding the room code is a player
// (role=member), signed in or not. The room code IS the only gate, which is
// the right model for a quick anonymous party game. We still strip any
// client-supplied identity and take userId/userName ONLY from a verified JWT;
// anonymous players pick their display name + stable device id via the SET_NAME
// game input.
//
// The signed-out case needs care. `authenticatedRoomRequest` returns early when
// `auth` is null and therefore never writes `x-user-role`, and the encoder it
// uses is not exported — so it cannot express "anonymous but member", which is
// exactly this route's contract. Without a role header GameRoom.onConnect falls
// back to viewer, `canWrite` is false, no one is seated and no game ever starts
// — silently. So guests are handed a synthetic identity here instead. The id
// uses the SDK's own ANONYMOUS_USER_ID_PREFIX, the same shape BaseRoom minted
// per connection before v0.19.0, so persisted rooms stay compatible.
app.get('/ws/game/:roomId', async (c) => {
  const id = c.req.param('roomId')
  const token = new URL(c.req.url).searchParams.get('token')

  let auth: VerifyResult | null = null
  if (token) {
    auth = (await verifyJwt(jwtConfig(c.env), token)).result
    if (!auth) return new Response('Unauthorized', { status: 401 })
  }

  const roomAuth = auth
    ? { userId: auth.userId, claims: { name: auth.claims.name, image: auth.claims.image } }
    : { userId: `${ANONYMOUS_USER_ID_PREFIX}${crypto.randomUUID()}`, claims: {} }

  const ns = c.env.GAME_ROOMS
  const stub = ns.get(ns.idFromName(id))
  return stub.fetch(authenticatedRoomRequest(c.req.raw, roomAuth, { role: 'member' }))
})

// ---------------------------------------------------------------------------
// Server actions
// ---------------------------------------------------------------------------

app.post('/api/actions/:name', async (c) => {
  const auth = await resolveAuth(c.req.raw, c.env)
  if (!auth) return c.json({ error: 'Unauthorized' }, 401)
  const name = c.req.param('name')
  const action = actions[name]
  if (!action) return c.json({ error: 'Action not found' }, 404)
  const params = await c.req.json<Record<string, unknown>>()
  const callerJwt = c.req.header('Authorization')!.slice(7)
  const tools = createActionTools(c.env, auth.userId, callerJwt)
  const result = await action({ userId: auth.userId, params, tools, env: c.env, callerJwt })
  return c.json(result as unknown as Record<string, unknown>)
})

// ---------------------------------------------------------------------------
// Scoped R2 files → platform-worker
//
// The app has no local R2 binding by design; the platform-worker holds a
// shared `APP_FILES` bucket and scopes keys per-app via the `?scope=`
// query string:
//
//   POST   /api/files/upload?scope=app    → uploads under apps/<APP_NAME>/
//   POST   /api/files/upload              → uploads under apps/<APP_NAME>/users/<userId>/
//   GET    /api/files                     → list (same scoping)
//   GET    /api/files/<key>               → public read (no auth)
//   DELETE /api/files/<key>               → delete (auth required, scope-checked)
//
// Use `?scope=app` for content that belongs to the app as a whole (library
// preview images, AI-generated assets, etc.). Use the default user scope
// for per-user uploads (avatars, project assets). All write paths require
// a signed user JWT; reads are public.
// ---------------------------------------------------------------------------

app.all('/api/files/*', async (c) => {
  const auth = await resolveAuth(c.req.raw, c.env)
  const userId = auth?.userId ?? null

  const url = new URL(c.req.url)
  const platformUrl = new URL(c.req.url)
  platformUrl.pathname = url.pathname.replace('/api/files', '/internal/files')

  const headers = new Headers(c.req.raw.headers)
  // Strip any caller-supplied identity before re-asserting from the verified
  // JWT. platform-worker trusts `x-user-id` (gated by the HMAC'd app-identity
  // token) to scope `?scope=self` keys, so leaking a spoofed header here would
  // let an unauthenticated browser read another user's files.
  headers.delete('x-user-id')
  headers.set('x-app-identity-token', c.env.APP_IDENTITY_TOKEN)
  headers.set('x-app-id', c.env.DEEPSPACE_APP_ID)
  if (userId) headers.set('x-user-id', userId)

  const resp = await platformWorkerFetch(
    c.env,
    new Request(platformUrl.toString(), {
      method: c.req.method,
      headers,
      body: c.req.raw.body,
    }),
  )

  // Rewrite URLs in JSON responses to use the app's origin
  const contentType = resp.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) {
    const body = (await resp.json()) as Record<string, unknown>
    const rewriteUrl = (u: string) => u.replace(/^https?:\/\/[^/]+/, url.origin)
    if (typeof body.url === 'string') body.url = rewriteUrl(body.url)
    if (Array.isArray(body.files)) {
      for (const f of body.files as Array<Record<string, unknown>>) {
        if (typeof f.url === 'string') f.url = rewriteUrl(f.url)
      }
    }
    return c.json(body, resp.status as any)
  }

  return new Response(resp.body, { status: resp.status, headers: resp.headers })
})

// ---------------------------------------------------------------------------
// /_deepspace/* — same-origin proxy to api-worker for authenticated SDK
// hooks. Attaches APP_IDENTITY_TOKEN + DEEPSPACE_APP_ID so the browser never sees
// the platform secret. Every request requires a signed user JWT.
//
// SECURITY: exact (method, path) allowlist — not a prefix match. A prefix
// match leaks deploy/CLI surfaces like POST /api/subscriptions/sync into the
// browser context, where an XSS or compromised user session can become a
// confused deputy. Adding a new browser hook in the SDK requires explicitly
// extending the BROWSER_PROXY_ROUTES tuple below.
// ---------------------------------------------------------------------------

interface ProxyRoute {
  method: string
  path: string
}

const BROWSER_PROXY_ROUTES: ReadonlyArray<ProxyRoute> = [
  // useSubscription — read state, subscribe, manage billing.
  { method: 'GET',  path: '/_deepspace/subscriptions/me' },
  { method: 'POST', path: '/_deepspace/subscriptions/checkout' },
  { method: 'POST', path: '/_deepspace/subscriptions/portal' },
  // useCheckout (one-time charges)
  { method: 'POST', path: '/_deepspace/charges/create' },
  { method: 'GET',  path: '/_deepspace/charges/me' },
]

app.all('/_deepspace/*', async (c) => {
  const url = new URL(c.req.url)
  const method = c.req.method
  const route = BROWSER_PROXY_ROUTES.find(
    (r) => r.method === method && r.path === url.pathname,
  )
  if (!route) {
    return c.json({ error: 'not_found' }, 404)
  }

  const auth = await resolveAuth(c.req.raw, c.env)
  if (!auth?.userId) return c.json({ error: 'unauthorized' }, 401)

  // Always overwrite caller input with this worker's immutable app id.
  const forwardedParams = new URLSearchParams(url.search)
  forwardedParams.set('appId', c.env.DEEPSPACE_APP_ID)
  const queryString = forwardedParams.toString()
  const apiPath =
    url.pathname.replace('/_deepspace/', '/api/') + (queryString ? `?${queryString}` : '')

  const headers = new Headers(c.req.raw.headers)
  headers.delete('x-user-id')
  headers.set('x-app-identity-token', c.env.APP_IDENTITY_TOKEN)
  headers.set('x-app-id', c.env.DEEPSPACE_APP_ID)
  headers.set('x-user-id', auth.userId)

  return apiWorkerFetch(c.env, apiPath, {
    method,
    headers,
    body: ['GET', 'HEAD'].includes(method) ? undefined : c.req.raw.body,
  })
})

// ---------------------------------------------------------------------------
// Static assets (SPA fallback)
// ---------------------------------------------------------------------------

app.get('*', async (c) => {
  const response = await c.env.ASSETS.fetch(c.req.raw)
  if (response.status === 404) {
    const url = new URL(c.req.url)
    // A FILE, not a client route: a miss must 404. Returning the shell here
    // is HTML parsed as JavaScript, which is a blank page.
    if (url.pathname.slice(url.pathname.lastIndexOf('/') + 1).includes('.')) {
      return c.json({ error: 'not_found' }, 404)
    }
    url.pathname = '/'
    return c.env.ASSETS.fetch(new Request(url.toString(), c.req.raw))
  }
  return response
})

// =============================================================================
// Action Tools — route to app's own RecordRoom DO
// =============================================================================

function createActionTools(env: Env, userId: string, callerJwt: string): ActionTools {
  const stub = env.RECORD_ROOMS.get(env.RECORD_ROOMS.idFromName(`app:${env.APP_NAME}`))

  // Internal helper — DO returns `ActionResult<unknown>`. Callers below
  // cast to the precisely-typed result for each operation. The cast is
  // safe because the wire shape is set by the SDK's tools-api handler.
  async function execTool<TData>(
    tool: string,
    params: Record<string, unknown>,
  ): Promise<ActionResult<TData>> {
    const res = await stub.fetch(new Request('https://internal/api/tools/execute', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-User-Id': userId,
        'X-App-Action': 'true',
      },
      body: JSON.stringify({ tool, params }),
    }))
    return res.json() as Promise<ActionResult<TData>>
  }

  async function callIntegration<T>(
    endpoint: string,
    data?: unknown,
  ): Promise<ActionResult<T>> {
    const integrationName = endpoint.split('/')[0]
    const billingMode = integrations[integrationName]?.billing ?? 'developer'

    // Use the owner JWT for developer-billed calls, the caller's JWT otherwise.
    // The api-worker bills the JWT subject — no client-supplied override.
    const jwt = billingMode === 'developer' ? env.APP_OWNER_JWT : callerJwt

    const res = await apiWorkerFetch(env, `/api/integrations/${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${jwt}`,
      },
      body: JSON.stringify(data ?? {}),
    })
    return res.json() as Promise<ActionResult<T>>
  }

  return {
    create: (collection, data, recordId) =>
      execTool('records.create', { collection, data, recordId }),
    update: (collection, recordId, data) =>
      execTool('records.update', { collection, recordId, data }),
    remove: (collection, recordId) => execTool('records.delete', { collection, recordId }),
    get: (collection, recordId) => execTool('records.get', { collection, recordId }),
    query: (collection, options) => execTool('records.query', { collection, ...options }),
    integration: callIntegration,
    registerUser: (opts) => execTool('users.register', { ...opts }),
  }
}

export default app
