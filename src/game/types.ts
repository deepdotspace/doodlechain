/**
 * Doodle Chain game types — the authoritative contract shared by the worker
 * engine (AppGameRoom) and the client (useDoodleChain). Pure module: no React,
 * no DeepSpace imports, so the whole reducer is unit-testable without a worker.
 *
 * The mechanic (a "drawing telephone"): every player starts a chain with a
 * written prompt, then each round the stacks pass one seat forward — you DRAW
 * the text you received, the next player GUESSES your drawing, the next DRAWS
 * that guess, and so on. After N rounds (N = player count) a shared slideshow
 * reveals how each chain mutated.
 */

/** Bump when the GameState shape changes (drives onHydrateState in the DO). */
export const STATE_VERSION = 1

export type Phase =
  | 'LOBBY' //   waiting for players; host can begin
  | 'PROMPT' //  round 0 — everyone writes the seed prompt for their own chain
  | 'DRAW' //    odd rounds — draw the text you received
  | 'GUESS' //   even rounds — caption the drawing you received
  | 'REVEAL' //  shared, host-paced slideshow of every chain
  | 'DONE' //    final screen; host can play again

/** A single link in a chain. Round 0 is always a prompt; then draw/guess alternate. */
export type StepType = 'prompt' | 'drawing' | 'guess'

export interface ChainStep {
  /** Round index this step was produced in (0 = seed prompt). */
  round: number
  type: StepType
  /** cid of the player who authored it (stable per-device id). */
  authorCid: string
  authorName: string
  /**
   * For 'prompt' / 'guess': the text. For 'drawing': a JSON string of strokes
   * (see Stroke below). '' for a skipped text step; '[]' for a skipped drawing.
   */
  content: string
  /** True when the timer expired before the author submitted (placeholder). */
  skipped?: boolean
}

/** One chain — owned by the player seated at `order`, grows one step per round. */
export interface Chain {
  /** Seat index 0..N-1; also the rotation key. Stable for the whole game. */
  order: number
  ownerCid: string
  ownerName: string
  /** Step per round, keyed by round number. steps[0] is the seed prompt. */
  steps: Record<number, ChainStep>
}

export interface GameConfig {
  promptSeconds: number
  drawSeconds: number
  guessSeconds: number
  revealStepMs: number
}

export interface PlayerState {
  /** Server-stamped connection id (anon-<uuid> or auth user id). Roster key. */
  userId: string
  /**
   * Stable per-device id from localStorage. Survives a reconnect (the server
   * userId does not), so it is the identity used for seating, chain ownership,
   * and "which player in the broadcast is me". Empty until SET_NAME arrives.
   */
  cid: string
  name: string
  color: string
  isHost: boolean
  /** Derived from the SDK roster each tick. */
  connected: boolean
  /** Wall-clock ms at first join — stable ordering for seats + color. */
  joinedAt: number
  /** AI bot — no WS connection; driven server-side by the DO. */
  isBot?: boolean
}

/** A connected player as reported by the SDK roster (GameRoom.getPlayers()). */
export interface RosterEntry {
  userId: string
  userName: string
}

export interface GameState {
  v: number
  phase: Phase
  /** cid of the host (the player who created the room). */
  hostCid: string | null
  config: GameConfig
  /** Every player seen this game, keyed by server userId (includes the host). */
  players: Record<string, PlayerState>
  /**
   * Number of seated players, frozen at game start = totalRounds. Chains and
   * rotation use this, NOT the live roster size (which can change on a drop).
   */
  seatCount: number
  /** 0-based round. PROMPT=0, then DRAW/GUESS alternate up to seatCount-1. */
  round: number
  /** One chain per seat, index === order. Empty in LOBBY. */
  chains: Chain[]
  /** Wall-clock ms deadline for the current phase; null = no timer (LOBBY/DONE). */
  phaseEndsAt: number | null
  /** Shared slideshow cursor (REVEAL): which chain + how many steps shown. */
  revealChain: number
  revealStep: number
  /** Server wall-clock at the last broadcast (client clock-sync). */
  serverNow: number
}

/** Inputs a client can send via sendInput(action, data). */
export type InputAction =
  | 'CLAIM_HOST' //  first connection claims host
  | 'SET_NAME' //    set display name + register cid
  | 'SET_CONFIG' //  host tweaks draw/guess seconds in the lobby
  | 'ADD_BOTS' //    host adds AI bot players in the lobby
  | 'REMOVE_BOT' //  host removes one bot in the lobby
  | 'BEGIN' //       host starts the game / plays again
  | 'SKIP' //        host force-ends the current phase
  | 'SUBMIT_PROMPT'
  | 'SUBMIT_DRAWING'
  | 'SUBMIT_GUESS'
  | 'REVEAL_NEXT' // host advances the slideshow
  | 'REVEAL_BACK' // host steps the slideshow back

/** Raw input as collected by GameRoom each tick (userId server-stamped, trusted). */
export interface EngineInput {
  userId: string
  action: string
  data: Record<string, unknown>
}

/** A single freehand stroke: a color, a width, and a polyline of points. */
export interface Stroke {
  color: string
  width: number
  /** Flat [x0,y0,x1,y1,...] in 0..1 normalized canvas space, or {x,y} points. */
  points: number[]
}
