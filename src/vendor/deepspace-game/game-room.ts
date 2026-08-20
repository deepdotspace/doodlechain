/**
 * VENDORED FROM THE DEEPSPACE SDK — do not expect upstream updates.
 * =================================================================
 *
 * Source: `deepspace` v0.9.2, `src/server/rooms/game-room.ts`.
 * Reason: SDK v0.17.0 deleted `GameRoom`, `useGameRoom`, the `GamePlayer` /
 *   `GameInput` / `Player` / `GameRoomConfig` / `UseGameRoomResult` types, and
 *   the eight `MSG.GAME_*` protocol constants, with no replacement. Apps that
 *   ran an authoritative tick loop on the SDK's `GameRoom` have to own the
 *   class themselves from 0.17.0 onward.
 *
 * Why this is cheap: `GameRoom` is nothing but `class GameRoom extends
 *   BaseRoom`. `BaseRoom` is still exported from `deepspace/worker` and its
 *   declaration is byte-identical between 0.9.2 and 0.23.2, so the class body
 *   below is the original, unchanged except for the import/protocol plumbing
 *   documented under "Vendoring deltas".
 *
 * Vendoring deltas (the only edits to the 0.9.2 body):
 *   1. `BaseRoom` / `UserAttachment` now come from `deepspace/worker` instead
 *      of the SDK-internal `./base-room`.
 *   2. The eight `GAME_*` wire constants are declared locally as `GAME_MSG`
 *      (identical strings) and merged with the SDK's surviving `MSG` into a
 *      drop-in `MSG` this module re-exports.
 *   3. `ROLES` is declared locally (identical values). The SDK still ships
 *      `ROLES`, but only from the client entry (`deepspace`); the worker entry
 *      exposes only `ROLE_ANONYMOUS` / `ROLE_DEFAULT` / `ROLE_ADMIN`, and a
 *      Durable Object must not pull in the React client bundle.
 *   4. The game arms of the wire protocol were removed from the SDK's
 *      `ServerMessage` union in 0.17.0, so this module declares
 *      `GameServerMessage` (= `ServerMessage` + the seven game arms) and
 *      overrides `sendTo` / `broadcast` with that widened union. This is the
 *      exact extension point the SDK's own `BaseRoom.sendTo` doc comment
 *      prescribes for app-specific messages.
 *
 * Nothing else changed. The behaviour, the SQLite schema (`game_state`), the
 * wire strings, and the subclass hook contract are all identical to 0.9.2,
 * so persisted state and existing clients keep working across the upgrade.
 */

/**
 * GameRoom — Authoritative game loop Durable Object.
 *
 * Extends BaseRoom with:
 * - Alarm-based tick loop with configurable interval
 * - Player management (join, leave, ready state)
 * - Input collection per tick, authoritative state computation
 * - State broadcast to all connected players
 *
 * Subclasses implement game logic via lifecycle hooks:
 *   onTick, onPlayerJoin, onPlayerLeave, onGameStart, onGameEnd
 *
 * Message types: game.*
 */

/// <reference types="@cloudflare/workers-types" />

import {
  BaseRoom,
  MSG as CORE_MSG,
  type BaseMessage,
  type ServerMessage,
  type UserAttachment,
} from 'deepspace/worker'

export type { UserAttachment }

// ============================================================================
// Vendored protocol constants
// ============================================================================

/**
 * The eight game wire constants, verbatim from the SDK's
 * `shared/protocol/constants.ts` before 0.17.0 removed them. The strings are
 * the on-wire contract — changing one breaks every already-deployed client.
 */
export const GAME_MSG = {
  GAME_STATE: 'game.state',
  GAME_INPUT: 'game.input',
  GAME_PLAYER_JOIN: 'game.player_join',
  GAME_PLAYER_LEAVE: 'game.player_leave',
  GAME_PLAYER_READY: 'game.player_ready',
  GAME_START: 'game.start',
  GAME_END: 'game.end',
  GAME_TICK: 'game.tick',
} as const

/**
 * Drop-in replacement for `deepspace/worker`'s `MSG`: every constant the SDK
 * still ships, plus the game constants it dropped. Worker-side app code that
 * used to `import { MSG } from 'deepspace/worker'` can import it from here
 * instead and keep using `MSG.GAME_INPUT` alongside `MSG.ERROR`.
 */
export const MSG = { ...CORE_MSG, ...GAME_MSG } as const

/** Type of any message type constant known to this module. */
export type MsgType = (typeof MSG)[keyof typeof MSG]

/**
 * Standard DeepSpace role constants, vendored from the SDK's
 * `shared/roles.ts`. Same values the platform's auth layer assigns.
 */
export const ROLES = {
  VIEWER: 'viewer',
  MEMBER: 'member',
  ADMIN: 'admin',
} as const

export type Role = (typeof ROLES)[keyof typeof ROLES]

/** Matches when a payload is intentionally empty — `{}` on the wire. */
type EmptyPayload = Record<string, never>

/**
 * The seven server → client game frames, restored from the SDK's pre-0.17.0
 * `ServerMessage` union.
 */
export type GameOnlyServerMessage =
  | BaseMessage<
      typeof MSG.GAME_STATE,
      { state: unknown; tick: number; players: unknown[]; running: boolean }
    >
  | BaseMessage<typeof MSG.GAME_TICK, { state: unknown; tick: number }>
  | BaseMessage<typeof MSG.GAME_START, { state: unknown; tick: number }>
  | BaseMessage<typeof MSG.GAME_END, { state: unknown; tick: number }>
  | BaseMessage<typeof MSG.GAME_PLAYER_JOIN, { player: unknown }>
  | BaseMessage<typeof MSG.GAME_PLAYER_LEAVE, { userId: string }>
  | BaseMessage<typeof MSG.GAME_PLAYER_READY, { userId: string }>

/**
 * Everything a `GameRoom` may put on the wire: the SDK's own server union
 * (`core.error`, `auth`, …) widened with the game frames. `sendTo` and
 * `broadcast` are overridden below to accept it — the widening the SDK's
 * `BaseRoom.sendTo` doc comment tells apps to do.
 */
export type GameServerMessage = ServerMessage | GameOnlyServerMessage

/**
 * The four client → server game frames, restored from the SDK's pre-0.17.0
 * `ClientMessage` union. Exported for app code that wants to type its own
 * senders; `GameRoom` itself reads untyped `{ type, payload }` off the wire
 * exactly as `BaseRoom` hands it over.
 */
export type GameClientMessage =
  | BaseMessage<typeof MSG.GAME_INPUT, { action: string; data: Record<string, unknown> }>
  | BaseMessage<typeof MSG.GAME_PLAYER_READY, EmptyPayload>
  | BaseMessage<typeof MSG.GAME_START, EmptyPayload>
  | BaseMessage<typeof MSG.GAME_END, EmptyPayload>

// ============================================================================
// Types
// ============================================================================

export interface GameRoomConfig {
  /** Ticks per second (default: 20) */
  tickRate?: number
  /** Minimum players to start (default: 1) */
  minPlayers?: number
  /** Maximum players (default: unlimited) */
  maxPlayers?: number
}

export interface Player {
  userId: string
  userName: string
  ready: boolean
  connectedAt: string
  data: Record<string, unknown>
}

export interface GameInput {
  userId: string
  action: string
  data: Record<string, unknown>
  tick: number
}

interface GameAttachment extends UserAttachment {
  joinedAt: string
  /** True for member/admin roles; false for viewers, unauthenticated anon, spectators. */
  canWrite: boolean
}

// Game-control messages that mutate state. Viewers can still receive
// broadcast game ticks (they're spectators), but they can't drive the game.
const GAME_WRITE_TYPES: ReadonlySet<string> = new Set([
  MSG.GAME_INPUT,
  MSG.GAME_PLAYER_READY,
  MSG.GAME_START,
  MSG.GAME_END,
])

// ============================================================================
// GameRoom
// ============================================================================

export abstract class GameRoom<E = Record<string, unknown>> extends BaseRoom<E> {
  private config: Required<GameRoomConfig>
  private players: Map<string, Player> = new Map()
  private inputBuffer: GameInput[] = []
  private currentTick = 0
  private gameState: Record<string, unknown> = {}
  private running = false
  private initialized = false

  constructor(
    state: DurableObjectState,
    env: unknown,
    config: GameRoomConfig = {}
  ) {
    super(state, env)
    this.config = {
      tickRate: config.tickRate ?? 20,
      minPlayers: config.minPlayers ?? 1,
      maxPlayers: config.maxPlayers ?? Infinity,
    }
  }

  // ==========================================================================
  // Wire-protocol widening (vendoring delta #4)
  // ==========================================================================

  /**
   * `BaseRoom.sendTo` is typed to the SDK's `ServerMessage`, which no longer
   * carries the game arms. Widen it here so the room's own frames compile,
   * and hand the base the same object — the cast is a union narrowing, not a
   * reinterpretation, and it is the single place the widening happens.
   */
  protected sendTo(ws: WebSocket, message: GameServerMessage): void {
    super.sendTo(ws, message as ServerMessage)
  }

  /** See `sendTo`. */
  protected broadcast(message: GameServerMessage, exclude?: WebSocket): void {
    super.broadcast(message as ServerMessage, exclude)
  }

  private ensureInitialized(): void {
    if (this.initialized) return
    this.initialized = true
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS game_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        state TEXT NOT NULL,
        tick INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      )
    `)
    // Load persisted state and give the subclass a chance to migrate it.
    // Subclasses with evolving schemas should override `onHydrateState`
    // to merge new fields, upgrade shapes, or discard stale blobs.
    const rows = this.sql.exec('SELECT state, tick FROM game_state WHERE id = 1').toArray()
    if (rows.length > 0) {
      try {
        const parsed = JSON.parse(rows[0].state as string) as Record<string, unknown>
        this.gameState = this.onHydrateState(parsed)
        this.currentTick = rows[0].tick as number
      } catch { /* fresh state */ }
    }
  }

  private persistState(): void {
    const now = new Date().toISOString()
    this.sql.exec(
      `INSERT INTO game_state (id, state, tick, updated_at) VALUES (1, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET state = ?, tick = ?, updated_at = ?`,
      JSON.stringify(this.gameState), this.currentTick, now,
      JSON.stringify(this.gameState), this.currentTick, now,
    )
  }

  // ==========================================================================
  // BaseRoom Lifecycle
  // ==========================================================================

  protected onConnect(ws: WebSocket, user: UserAttachment): GameAttachment {
    this.ensureInitialized()

    const role = (user.role as string | undefined) ?? ROLES.VIEWER
    const canWrite = role === ROLES.MEMBER || role === ROLES.ADMIN

    const attachment: GameAttachment = {
      ...user,
      joinedAt: new Date().toISOString(),
      canWrite,
    }

    // Sent before any state so the client knows from the first frame
    // whether to enable input controls. Both spectators and players get
    // it — the value differs by role.
    this.sendTo(ws, { type: MSG.AUTH, payload: { canWrite } })

    // Viewers and unauthenticated anon connections are spectators: they
    // receive game-state broadcasts but are NOT added to the players map.
    // Adding them would block auto-start (their never-ready entry keeps
    // readyCount < players.size) and let them appear in client UIs as
    // ghost players.
    if (!canWrite) {
      this.sendTo(ws, {
        type: MSG.GAME_STATE,
        payload: {
          state: this.gameState,
          tick: this.currentTick,
          players: Array.from(this.players.values()),
          running: this.running,
        },
      })
      return attachment
    }

    const player: Player = {
      userId: user.userId,
      userName: user.userName,
      ready: false,
      connectedAt: attachment.joinedAt,
      data: {},
    }

    if (this.config.maxPlayers !== Infinity && this.players.size >= this.config.maxPlayers) {
      this.sendTo(ws, { type: MSG.ERROR, payload: { error: 'Game is full' } })
      return attachment
    }

    this.players.set(user.userId, player)

    // Send current state to new player
    this.sendTo(ws, {
      type: MSG.GAME_STATE,
      payload: {
        state: this.gameState,
        tick: this.currentTick,
        players: Array.from(this.players.values()),
        running: this.running,
      },
    })

    // Notify others
    this.broadcast({ type: MSG.GAME_PLAYER_JOIN, payload: { player } }, ws)

    this.onPlayerJoin(player)

    return attachment
  }

  protected async onMessage(
    ws: WebSocket,
    user: UserAttachment,
    message: { type: string; [key: string]: unknown }
  ): Promise<void> {
    this.ensureInitialized()

    const { type, payload } = message as { type: string; payload: Record<string, unknown> }

    if (GAME_WRITE_TYPES.has(type) && !(user as GameAttachment).canWrite) {
      this.sendTo(ws, {
        type: MSG.ERROR,
        payload: { error: 'Write access denied: spectators cannot drive the game' },
      })
      return
    }

    switch (type) {
      case MSG.GAME_INPUT: {
        this.inputBuffer.push({
          userId: user.userId,
          action: payload.action as string,
          data: (payload.data ?? {}) as Record<string, unknown>,
          tick: this.currentTick,
        })
        break
      }

      case MSG.GAME_PLAYER_READY: {
        const player = this.players.get(user.userId)
        if (player) {
          player.ready = true
          this.broadcast({ type: MSG.GAME_PLAYER_READY, payload: { userId: user.userId } })
          this.checkAutoStart()
        }
        break
      }

      case MSG.GAME_START: {
        if (!this.running) {
          this.startGame()
        }
        break
      }

      case MSG.GAME_END: {
        if (this.running) {
          this.stopGame()
        }
        break
      }

      default:
        this.sendTo(ws, { type: MSG.ERROR, payload: { error: `Unknown game message type: ${type}` } })
    }
  }

  protected onDisconnect(_ws: WebSocket, user: UserAttachment): void {
    const player = this.players.get(user.userId)
    if (player) {
      this.players.delete(user.userId)
      this.broadcast({ type: MSG.GAME_PLAYER_LEAVE, payload: { userId: user.userId } })
      this.onPlayerLeave(player)

      if (this.running && this.players.size === 0) {
        this.stopGame()
      }
    }
  }

  protected async onAlarm(): Promise<void> {
    if (!this.running) return

    // Collect inputs for this tick
    const inputs = this.inputBuffer.splice(0)
    this.currentTick++

    // Let subclass compute new state
    const newState = await this.onTick(this.gameState, inputs, this.currentTick)
    if (newState !== undefined) {
      this.gameState = newState
    }

    // Persist every 10 ticks
    if (this.currentTick % 10 === 0) {
      this.persistState()
    }

    // Broadcast tick to all players
    this.broadcast({
      type: MSG.GAME_TICK,
      payload: {
        state: this.gameState,
        tick: this.currentTick,
      },
    })

    // Schedule next tick
    if (this.running) {
      const intervalMs = 1000 / this.config.tickRate
      this.state.storage.setAlarm(Date.now() + intervalMs)
    }
  }

  // ==========================================================================
  // Game Control
  // ==========================================================================

  private checkAutoStart(): void {
    if (this.running) return
    const readyCount = Array.from(this.players.values()).filter(p => p.ready).length
    if (readyCount >= this.config.minPlayers && readyCount === this.players.size) {
      this.startGame()
    }
  }

  private startGame(): void {
    this.running = true
    this.currentTick = 0
    this.inputBuffer = []
    this.onGameStart()
    this.broadcast({ type: MSG.GAME_START, payload: { state: this.gameState, tick: 0 } })

    // Start tick loop
    const intervalMs = 1000 / this.config.tickRate
    this.state.storage.setAlarm(Date.now() + intervalMs)
  }

  private stopGame(): void {
    this.running = false
    this.persistState()
    this.onGameEnd(this.gameState)
    this.broadcast({ type: MSG.GAME_END, payload: { state: this.gameState, tick: this.currentTick } })
  }

  // ==========================================================================
  // Protected Accessors (for subclasses)
  // ==========================================================================

  protected getGameState(): Record<string, unknown> {
    return this.gameState
  }

  protected setGameState(state: Record<string, unknown>): void {
    this.gameState = state
  }

  protected getPlayers(): Player[] {
    return Array.from(this.players.values())
  }

  protected isRunning(): boolean {
    return this.running
  }

  protected getCurrentTick(): number {
    return this.currentTick
  }

  // ==========================================================================
  // Lifecycle Hooks (subclasses override)
  // ==========================================================================

  /**
   * Called each tick with current state and collected inputs.
   * Return the new game state, or undefined to keep current state.
   */
  protected abstract onTick(
    state: Record<string, unknown>,
    inputs: GameInput[],
    tick: number
  ): Record<string, unknown> | undefined | Promise<Record<string, unknown> | undefined>

  /** Called when a player connects */
  protected onPlayerJoin(_player: Player): void {}

  /** Called when a player disconnects */
  protected onPlayerLeave(_player: Player): void {}

  /** Called when the game starts */
  protected onGameStart(): void {}

  /** Called when the game ends */
  protected onGameEnd(_finalState: Record<string, unknown>): void {}

  /**
   * Called once when the DO first hydrates persisted state from storage.
   * Receives the parsed state blob as it was written by a previous build.
   * Return the state object to install as `gameState`.
   *
   * Subclasses with evolving schemas should override this hook to:
   *   - merge new fields onto a default template,
   *   - upgrade shapes across versioned states,
   *   - or discard stale blobs entirely by returning a fresh object.
   *
   * The default implementation is a pass-through, preserving the legacy
   * "stored blob is gospel" behavior for subclasses that don't care.
   *
   * If JSON parsing of the stored blob fails this hook is NOT called — the
   * DO starts with an empty state and the subclass's `onGameStart` (or
   * first `onTick`) is responsible for initializing.
   */
  protected onHydrateState(
    stored: Record<string, unknown>,
  ): Record<string, unknown> {
    return stored
  }
}
