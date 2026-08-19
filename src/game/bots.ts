/**
 * Bot content for Doodle Chain.
 *
 * Bots draw by serving a real human doodle that matches the prompt (see
 * `doodles.ts` — a curated Google "Quick, Draw!" pack). This module is the PURE,
 * SDK-free rest of the bot brain: names, the canned prompts a bot writes (the
 * seeds humans then draw), canned guesses, the offline fallback doodle, and the
 * seat math that says what a bot owes this turn. The DO (AppGameRoom) drives it.
 *
 * There is no LLM here (or anywhere in the bot path) — an LLM drawing blind
 * renders as scribble, and a curated human-doodle library looks far better for
 * free. Bot prompts/guesses are canned because a random quip is indistinguishable
 * from a "smart" one and skipping the call keeps the game instant and offline.
 */

import type { GameState, PlayerState, Stroke } from './types'
import { assignedChainOrder } from './rotation'

// --- Timing -----------------------------------------------------------------

/** Bots wait this long into a phase before acting, so humans see the phase first. */
export const BOT_THINK_MS = 2600

// --- Names ------------------------------------------------------------------

const BOT_NAMES = ['Pixel', 'Doodlebot', 'Scribbles', 'Inkling', 'Sketchy', 'Crayon', 'Marker', 'Smudge']

export function botName(i: number): string {
  return BOT_NAMES[i % BOT_NAMES.length]
}

// --- Canned prompts + guesses -----------------------------------------------

/**
 * Prompts a bot writes as chain seeds. Each names a concrete noun the doodle pack
 * covers, so when the next player (or another bot) draws it, a matching human
 * doodle is available.
 */
const PROMPTS = [
  'a cat DJing at a party',
  'a banana riding a bicycle',
  'a grumpy cloud raining on one person',
  'a frog wearing a crown',
  'a dog walking a snail',
  'a shark playing the guitar',
  'a cactus giving a hug',
  'an owl delivering pizza',
  'a snowman on vacation',
  'a hot air balloon racing a duck',
  'a penguin running for president',
  'a spider knitting a sweater',
]

const GUESSES = [
  'a happy dog',
  'a confused octopus',
  'a dancing tree',
  'a sandwich with legs',
  'a sleepy dragon',
  'a fish on a bike',
  'a melting ice cream',
  'a tiny angry bird',
  'a wizard cat',
  'a haunted castle',
  'a brave little mouse',
  'a flying potato',
]

/** Deterministic-ish pick so a single room varies but doesn't need RNG state. */
function pick<T>(arr: T[], seed: number): T {
  return arr[Math.abs(seed) % arr.length]
}

export function botPrompt(seed: number): string {
  return pick(PROMPTS, seed)
}

export function botGuess(seed: number): string {
  return pick(GUESSES, seed)
}

/**
 * The offline fallback doodle — a loose blobby creature — as a JSON strokes
 * string in the canvas wire format. Only used if the doodle pack is somehow
 * empty; the normal path serves a real human doodle (see `botDoodle`).
 */
export function botDrawing(seed: number): string {
  const colors = ['#e8553b', '#2d8a6d', '#3b6fd4', '#c0418f', '#f2a93b', '#7a52d6']
  const c = colors[Math.abs(seed) % colors.length]
  const cx = 0.4 + (Math.abs(seed) % 20) / 100
  const cy = 0.45 + (Math.abs(seed >> 2) % 20) / 100
  const r = 0.18

  const body: number[] = []
  for (let a = 0; a <= Math.PI * 2 + 0.2; a += Math.PI / 8) {
    body.push(round(cx + Math.cos(a) * r), round(cy + Math.sin(a) * r * 0.85))
  }
  const strokes: Stroke[] = [
    { color: c, width: 7, points: body },
    { color: '#1c1a17', width: 6, points: [round(cx - 0.06), round(cy - 0.04), round(cx - 0.06), round(cy - 0.03)] },
    { color: '#1c1a17', width: 6, points: [round(cx + 0.06), round(cy - 0.04), round(cx + 0.06), round(cy - 0.03)] },
    { color: '#1c1a17', width: 5, points: [round(cx - 0.07), round(cy + 0.05), round(cx), round(cy + 0.09), round(cx + 0.07), round(cy + 0.05)] },
  ]
  return JSON.stringify(strokes)
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000
}

/** Stable non-negative hash of a string — seeds fallbacks + per-bot jitter. */
export function strHash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return Math.abs(h | 0)
}

// --- Turn resolution --------------------------------------------------------

export interface BotTurn {
  phase: 'PROMPT' | 'DRAW' | 'GUESS'
  round: number
  /** The content the bot must respond to (the prior step to draw/caption); '' for PROMPT. */
  source: string
}

/**
 * What the bot owes this tick, or null (not its turn / already done / not seated).
 * Mirrors the seat math the humans go through: PROMPT authors the bot's own
 * chain; later rounds act on the chain the rotation assigns.
 */
export function botTurn(s: GameState, bot: PlayerState): BotTurn | null {
  if (s.phase !== 'PROMPT' && s.phase !== 'DRAW' && s.phase !== 'GUESS') return null
  const seat = s.chains.findIndex((c) => c.ownerCid === bot.cid)
  if (seat < 0) return null
  const round = s.round
  const chainOrder = s.phase === 'PROMPT' ? seat : assignedChainOrder(seat, round, s.seatCount)
  const chain = s.chains[chainOrder]
  if (!chain || chain.steps[round]) return null // no such chain / already submitted
  const source = round > 0 ? chain.steps[round - 1]?.content ?? '' : ''
  return { phase: s.phase, round, source }
}
