/**
 * The Doodle Chain engine — a pure reducer over GameState. No React, no SDK.
 *
 * `reduce(prev, inputs, now, roster)` is called once per server tick by the DO
 * (AppGameRoom). It:
 *   1. reconciles the connected-player roster (join / drop),
 *   2. applies buffered player inputs (host authority enforced here),
 *   3. runs timer-driven phase transitions, auto-advancing early when every
 *      seat has submitted, and synthesizing placeholder steps for anyone who
 *      timed out so the chain rotation invariant always holds,
 * returning the next state — or `null` when nothing meaningful changed, so the
 * DO can skip the persist + broadcast on idle ticks.
 *
 * Identity: players are keyed by the server-stamped `userId`, but seating and
 * chain ownership use the stable per-device `cid` (so a disconnect + rejoin,
 * which mints a fresh anon userId, lands the player back in their own seat).
 *
 * Unlike a Fibbage-style game there is no separate host "stage" — the host is a
 * full player who also draws and guesses; they just hold the lobby/skip/reveal
 * controls.
 */

import type {
  Chain,
  ChainStep,
  EngineInput,
  GameState,
  Phase,
  PlayerState,
  RosterEntry,
  Stroke,
} from './types'
import { STATE_VERSION } from './types'
import {
  DEFAULT_CONFIG,
  DRAW_SECONDS_CHOICES,
  GUESS_SECONDS_CHOICES,
  MAX_NAME_LENGTH,
  MAX_PLAYERS,
  MAX_POINTS_PER_STROKE,
  MAX_STROKES,
  MAX_TEXT_LENGTH,
  MIN_PLAYERS,
  nextColor,
} from './config'
import { assignedChainOrder, holderSeatForChain, isDrawingRound } from './rotation'

export function createInitialState(): GameState {
  return {
    v: STATE_VERSION,
    phase: 'LOBBY',
    hostCid: null,
    config: { ...DEFAULT_CONFIG },
    players: {},
    seatCount: 0,
    round: 0,
    chains: [],
    phaseEndsAt: null,
    revealChain: 0,
    revealStep: 0,
    serverNow: 0,
  }
}

export function sanitizeName(raw: unknown): string {
  const s = typeof raw === 'string' ? raw : ''
  const cleaned = s.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LENGTH)
  return cleaned.length > 0 ? cleaned : 'Player'
}

function sanitizeText(raw: unknown): string {
  const s = typeof raw === 'string' ? raw : ''
  return s.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT_LENGTH)
}

/** Connected players (humans + bots), in stable join order. Includes the host. */
export function roster(state: GameState): PlayerState[] {
  return Object.values(state.players)
    .filter((p) => p.connected)
    .sort((a, b) => a.joinedAt - b.joinedAt || a.userId.localeCompare(b.userId))
}

/** The player whose cid matches, if any (used to resolve a submitter's seat). */
function playerByCid(state: GameState, cid: string): PlayerState | undefined {
  return Object.values(state.players).find((p) => p.cid === cid && p.cid !== '')
}

/** Seat index (chain order) owned by `cid`, or -1 if not seated. */
function seatOfCid(state: GameState, cid: string): number {
  return state.chains.findIndex((c) => c.ownerCid === cid)
}

/** Add an AI bot to the lobby — no WS connection; the DO drives its inputs. */
function makeBot(s: GameState, name: string, now: number): void {
  let n = 1
  while (s.players[`bot-${n}`]) n++
  const id = `bot-${n}`
  const used = Object.values(s.players).map((p) => p.color)
  s.players[id] = {
    userId: id,
    cid: id,
    name: sanitizeName(name),
    color: nextColor(used),
    isHost: false,
    connected: true,
    joinedAt: now + n, // tiny offset keeps bot ordering stable within a tick
    isBot: true,
  }
}

export function reduce(
  prev: GameState,
  inputs: EngineInput[],
  now: number,
  rosterEntries: RosterEntry[],
): GameState | null {
  const s: GameState = structuredClone(prev)
  let changed = false
  const touch = () => {
    changed = true
  }

  // --- 1. Reconcile roster -------------------------------------------------
  const rosterIds = new Set(rosterEntries.map((r) => r.userId))
  for (const entry of rosterEntries) {
    const existing = s.players[entry.userId]
    if (!existing) {
      const used = Object.values(s.players).map((p) => p.color)
      s.players[entry.userId] = {
        userId: entry.userId,
        cid: '',
        name: sanitizeName(entry.userName),
        color: nextColor(used),
        isHost: false,
        connected: true,
        joinedAt: now,
      }
      touch()
    } else if (!existing.connected) {
      existing.connected = true
      touch()
    }
  }
  for (const p of Object.values(s.players)) {
    if (!rosterIds.has(p.userId) && p.connected && !p.isBot) {
      p.connected = false
      touch()
    }
  }

  // --- 2. Apply inputs -----------------------------------------------------
  for (const input of inputs) {
    const player = s.players[input.userId]
    const isHost = !!player && player.cid !== '' && player.cid === s.hostCid
    switch (input.action) {
      case 'CLAIM_HOST': {
        const hostPlayer = s.hostCid ? playerByCid(s, s.hostCid) : undefined
        const hostVacant = !s.hostCid || !hostPlayer?.connected
        if (hostVacant && player && player.cid !== '') {
          if (s.hostCid) {
            const old = playerByCid(s, s.hostCid)
            if (old) old.isHost = false
          }
          s.hostCid = player.cid
          player.isHost = true
          touch()
        }
        break
      }
      case 'SET_NAME': {
        if (player) {
          const name = sanitizeName(input.data.name)
          const cid = typeof input.data.cid === 'string' ? input.data.cid.slice(0, 64) : player.cid
          if (name !== player.name || cid !== player.cid) {
            player.name = name
            player.cid = cid
            // Re-link host flag after a rejoin (fresh userId, same cid).
            if (cid !== '' && cid === s.hostCid) player.isHost = true
            touch()
          }
        }
        break
      }
      case 'SET_CONFIG': {
        if (isHost && s.phase === 'LOBBY') {
          const d = Number(input.data.drawSeconds)
          const g = Number(input.data.guessSeconds)
          if ((DRAW_SECONDS_CHOICES as readonly number[]).includes(d) && d !== s.config.drawSeconds) {
            s.config.drawSeconds = d
            touch()
          }
          if ((GUESS_SECONDS_CHOICES as readonly number[]).includes(g) && g !== s.config.guessSeconds) {
            s.config.guessSeconds = g
            touch()
          }
        }
        break
      }
      case 'ADD_BOTS': {
        if (isHost && s.phase === 'LOBBY') {
          const count = Math.max(0, Math.min(8, Math.floor(Number(input.data.count) || 0)))
          const names = Array.isArray(input.data.names) ? (input.data.names as unknown[]) : []
          for (let i = 0; i < count; i++) {
            if (roster(s).length >= MAX_PLAYERS) break
            const nm = typeof names[i] === 'string' ? (names[i] as string) : `Bot ${i + 1}`
            makeBot(s, nm, now)
            touch()
          }
        }
        break
      }
      case 'REMOVE_BOT': {
        if (isHost && s.phase === 'LOBBY') {
          const botId = typeof input.data.botId === 'string' ? input.data.botId : ''
          if (s.players[botId]?.isBot) {
            delete s.players[botId]
            touch()
          }
        }
        break
      }
      case 'BEGIN': {
        if (isHost) {
          if (s.phase === 'LOBBY' && seatableCount(s) >= MIN_PLAYERS) {
            startGame(s, now)
            touch()
          } else if (s.phase === 'DONE') {
            resetToLobby(s)
            touch()
          }
        }
        break
      }
      case 'SKIP': {
        if (isHost && s.phaseEndsAt !== null) {
          s.phaseEndsAt = now // force this phase's timeout transition below
          touch()
        }
        break
      }
      case 'SUBMIT_PROMPT': {
        if (s.phase === 'PROMPT' && player) {
          const seat = seatOfCid(s, player.cid)
          if (seat >= 0 && !s.chains[seat].steps[0]) {
            s.chains[seat].steps[0] = {
              round: 0,
              type: 'prompt',
              authorCid: player.cid,
              authorName: player.name,
              content: sanitizeText(input.data.text) || randomSeedPrompt(seat, s),
            }
            touch()
          }
        }
        break
      }
      case 'SUBMIT_DRAWING': {
        if (s.phase === 'DRAW' && player) {
          recordStep(s, player, 'drawing', clampDrawing(input.data.strokes))
          touch()
        }
        break
      }
      case 'SUBMIT_GUESS': {
        if (s.phase === 'GUESS' && player) {
          recordStep(s, player, 'guess', sanitizeText(input.data.text))
          touch()
        }
        break
      }
      case 'REVEAL_NEXT': {
        if (isHost && s.phase === 'REVEAL') {
          advanceReveal(s, now)
          touch()
        }
        break
      }
      case 'REVEAL_BACK': {
        if (isHost && s.phase === 'REVEAL') {
          stepRevealBack(s)
          touch()
        }
        break
      }
      default:
        break
    }
  }

  // --- 3. Timer-driven transitions ----------------------------------------
  let guard = 0
  while (guard++ < 16 && advance(s, now)) {
    touch()
  }

  if (!changed) return null
  s.serverNow = now
  return s
}

/** Players eligible to be seated when the game starts (connected, named). */
function seatableCount(s: GameState): number {
  return roster(s).filter((p) => p.cid !== '').length
}

/** Record a draw/guess step on the chain the player is assigned this round. */
function recordStep(s: GameState, player: PlayerState, type: 'drawing' | 'guess', content: string): void {
  const seat = seatOfCid(s, player.cid)
  if (seat < 0) return // spectator (joined mid-game) — no seat this game
  const chainOrder = assignedChainOrder(seat, s.round, s.seatCount)
  const chain = s.chains[chainOrder]
  if (!chain || chain.steps[s.round]) return // already submitted
  chain.steps[s.round] = {
    round: s.round,
    type,
    authorCid: player.cid,
    authorName: player.name,
    content,
  }
}

/** Has every chain produced its step for `round`? Drives early-advance. */
function everyoneSubmitted(s: GameState): boolean {
  if (s.chains.length === 0) return false
  return s.chains.every((c) => c.steps[s.round] !== undefined)
}

/** Fill any chain missing a step for `round` with a skipped placeholder. */
function synthesizeMissing(s: GameState): void {
  const type: ChainStep['type'] = s.round === 0 ? 'prompt' : isDrawingRound(s.round) ? 'drawing' : 'guess'
  const fallback = type === 'drawing' ? '[]' : ''
  for (const chain of s.chains) {
    if (chain.steps[s.round]) continue
    const seat = s.round === 0 ? chain.order : holderSeatForChain(chain.order, s.round, s.seatCount)
    const owner = s.chains[seat]
    chain.steps[s.round] = {
      round: s.round,
      type,
      authorCid: owner?.ownerCid ?? 'system',
      authorName: owner?.ownerName ?? 'Skipped',
      content: type === 'prompt' ? randomSeedPrompt(chain.order, s) : fallback,
      skipped: true,
    }
  }
}

/** Returns true if it performed a transition. */
function advance(s: GameState, now: number): boolean {
  if (s.phaseEndsAt === null) return false
  const timedOut = now >= s.phaseEndsAt

  switch (s.phase) {
    case 'PROMPT': {
      if (timedOut || everyoneSubmitted(s)) {
        synthesizeMissing(s)
        s.round = 1
        enterPhase(s, 'DRAW', now)
        return true
      }
      return false
    }
    case 'DRAW':
    case 'GUESS': {
      if (timedOut || everyoneSubmitted(s)) {
        synthesizeMissing(s)
        if (s.round >= s.seatCount) {
          enterReveal(s, now)
        } else {
          s.round += 1
          enterPhase(s, isDrawingRound(s.round) ? 'DRAW' : 'GUESS', now)
        }
        return true
      }
      return false
    }
    case 'REVEAL': {
      if (timedOut) {
        advanceReveal(s, now)
        return true
      }
      return false
    }
    default:
      return false
  }
}

function enterPhase(s: GameState, phase: Phase, now: number): void {
  s.phase = phase
  const ms = phaseDurationMs(s, phase)
  s.phaseEndsAt = ms === null ? null : now + ms
}

function phaseDurationMs(s: GameState, phase: Phase): number | null {
  switch (phase) {
    case 'PROMPT':
      return s.config.promptSeconds * 1000
    case 'DRAW':
      return s.config.drawSeconds * 1000
    case 'GUESS':
      return s.config.guessSeconds * 1000
    case 'REVEAL':
      return s.config.revealStepMs
    default:
      return null // LOBBY, DONE
  }
}

function startGame(s: GameState, now: number): void {
  const seated = roster(s).filter((p) => p.cid !== '')
  const n = seated.length
  s.seatCount = n
  s.chains = seated.map((p, i) => ({
    order: i,
    ownerCid: p.cid,
    ownerName: p.name,
    steps: {},
  })) as Chain[]
  s.round = 0
  s.revealChain = 0
  s.revealStep = 0
  enterPhase(s, 'PROMPT', now)
}

function resetToLobby(s: GameState): void {
  s.chains = []
  s.seatCount = 0
  s.round = 0
  s.revealChain = 0
  s.revealStep = 0
  s.phase = 'LOBBY'
  s.phaseEndsAt = null
}

function enterReveal(s: GameState, now: number): void {
  s.phase = 'REVEAL'
  s.revealChain = 0
  s.revealStep = 0
  s.phaseEndsAt = now + s.config.revealStepMs
}

/** Total steps in a chain = prompt (0) + rounds 1..seatCount. */
function stepsInChain(s: GameState): number {
  return s.seatCount + 1
}

function advanceReveal(s: GameState, now: number): void {
  const lastStep = stepsInChain(s) - 1
  const lastChain = s.chains.length - 1
  if (s.revealStep < lastStep) {
    s.revealStep += 1
  } else if (s.revealChain < lastChain) {
    s.revealChain += 1
    s.revealStep = 0
  } else {
    s.phase = 'DONE'
    s.phaseEndsAt = null
    return
  }
  s.phaseEndsAt = now + s.config.revealStepMs
}

function stepRevealBack(s: GameState): void {
  if (s.revealStep > 0) {
    s.revealStep -= 1
  } else if (s.revealChain > 0) {
    s.revealChain -= 1
    s.revealStep = stepsInChain(s) - 1
  }
}

/**
 * Clamp a strokes payload to a bounded, well-formed JSON string the DO can
 * safely store and rebroadcast. The drawing comes from an anonymous client, so
 * it is UNTRUSTED: we hard-cap stroke count and points-per-stroke, coerce
 * numbers into [0,1], and drop anything malformed. This is the load-bearing
 * backstop the config comment promises — without it a single client could blow
 * the DO state budget by submitting a multi-megabyte strokes blob.
 */
function clampDrawing(raw: unknown): string {
  let parsed: unknown = raw
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw)
    } catch {
      return '[]'
    }
  }
  if (!Array.isArray(parsed)) return '[]'

  const out: Stroke[] = []
  for (const entry of parsed) {
    if (out.length >= MAX_STROKES) break
    if (!entry || typeof entry !== 'object') continue
    const s = entry as Record<string, unknown>
    const color = typeof s.color === 'string' ? s.color.slice(0, 24) : '#1c1a17'
    const width =
      typeof s.width === 'number' && Number.isFinite(s.width) ? Math.max(1, Math.min(80, s.width)) : 6
    const rawPts = Array.isArray(s.points) ? s.points : []
    const limit = Math.min(rawPts.length - (rawPts.length % 2), MAX_POINTS_PER_STROKE * 2)
    const points: number[] = []
    for (let i = 0; i < limit; i++) {
      const n = rawPts[i]
      if (typeof n !== 'number' || !Number.isFinite(n)) {
        points.length = points.length - (points.length % 2) // keep pairs aligned
        break
      }
      points.push(Math.max(0, Math.min(1, Math.round(n * 1000) / 1000)))
    }
    if (points.length >= 2) out.push({ color, width, points })
  }
  return JSON.stringify(out)
}

/** A deterministic fallback seed prompt so a skipped chain still reads sensibly. */
const SEED_PROMPTS = [
  'a cat riding a skateboard',
  'a wizard losing his hat',
  'a robot baking cookies',
  'a shark at a birthday party',
  'a dragon learning to swim',
  'an astronaut walking a dog',
  'a penguin on a hot beach',
  'a ghost reading a newspaper',
  'a dinosaur in a tiny car',
  'a snail winning a race',
]
function randomSeedPrompt(seat: number, s: GameState): string {
  return SEED_PROMPTS[(seat + s.seatCount) % SEED_PROMPTS.length]
}
