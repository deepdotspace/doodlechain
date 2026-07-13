/**
 * Bot content for Doodle Chain.
 *
 * Bots draw with AI now. The DO hands a cheap LLM (Haiku) the prompt a bot is
 * meant to draw and asks for stroke JSON, so a bot's doodle actually reflects
 * the prompt instead of always scribbling the same blobby face. The prompts a
 * bot writes (the seeds humans then draw) are AI-written too. Guesses stay
 * canned — a guess unrelated to the drawing is indistinguishable from a random
 * quip, and skipping that call keeps cost down.
 *
 * This is a PURE module (no SDK, no DO): prompt builders, output parsing +
 * validation, the offline canned fallbacks, and the budget counter math. The DO
 * (AppGameRoom) owns the fire-and-forget call and the spend guards. Every AI
 * path has a canned fallback (bad JSON, denied budget, network error, timeout)
 * so a round never hangs on the model.
 */

import type { GameState, PlayerState, Stroke } from './types'
import { assignedChainOrder } from './rotation'
import { MAX_TEXT_LENGTH } from './config'

// --- Model + guard constants ------------------------------------------------

/** Cheapest capable model; bot doodles are meant to be rough, so Haiku is plenty. */
export const BOT_MODEL = 'claude-haiku-4-5'
/** Stroke JSON is a few hundred tokens; leave headroom without inviting essays. */
export const BOT_MAX_TOKENS_DRAW = 900
/** A one-line prompt. */
export const BOT_MAX_TOKENS_TEXT = 40
/** Bots wait this long into a phase before acting, so humans see the phase first. */
export const BOT_THINK_MS = 2600
/** Per-room lifetime cap on billed generations — bounds a play-again-looping room. */
export const ROOM_BOT_LIFETIME = 200
/** Global daily cap on billed generations — the abuse backstop (resets UTC midnight). */
export const DAILY_BOT_CAP = 2000

// --- Names ------------------------------------------------------------------

const BOT_NAMES = ['Pixel', 'Doodlebot', 'Scribbles', 'Inkling', 'Sketchy', 'Crayon', 'Marker', 'Smudge']

export function botName(i: number): string {
  return BOT_NAMES[i % BOT_NAMES.length]
}

// --- Canned fallbacks (used when AI is unavailable / denied / malformed) -----

const PROMPTS = [
  'a cat DJing at a party',
  'a banana riding a unicycle',
  'a grumpy cloud raining on one person',
  'a frog wearing sunglasses',
  'a robot walking a snail',
  'a pirate afraid of water',
  'a cactus giving a hug',
  'an owl delivering pizza',
  'a snowman on vacation',
  'a turtle racing a rocket',
  'a duck running for president',
  'a spider knitting a sweater',
]

const GUESSES = [
  'a happy dog',
  'a confused robot',
  'a dancing tree',
  'a sandwich with legs',
  'a sleepy dragon',
  'a fish on a bike',
  'a melting ice cream',
  'a tiny angry bird',
  'a wizard cat',
  'a haunted toaster',
  'a brave little ghost',
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
 * string in the canvas wire format. Only used when the AI path is unavailable.
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

// --- LLM prompt builders ----------------------------------------------------

export const DRAW_SYSTEM = [
  'You are a player in a fast, casual doodle party game (like drawing telephone).',
  'You will be given a short prompt to DRAW. Reply with ONLY a JSON array of pen',
  'strokes — no prose, no markdown, no code fences.',
  '',
  'Each stroke is an object:',
  '{"color":"#RRGGBB","width":6,"points":[x0,y0,x1,y1,...]}',
  '- x and y are decimals from 0 to 1 (0,0 = top-left, 1,1 = bottom-right).',
  '- width is 2 to 40.',
  '- points is at least two (x,y) pairs; more pairs make a longer curved line.',
  '',
  'Rules:',
  '- Use 4 to 14 strokes. Keep everything within 0.1..0.9 so nothing clips.',
  '- Make it clearly READ as the prompt, but rough and quick, like a person',
  '  doodling in 30 seconds. Simple shapes, a few colors.',
  '- Do NOT draw any letters, words, or numbers.',
  '- Output the JSON array and nothing else.',
].join('\n')

export function buildDrawUser(subject: string): string {
  const s = subject.trim()
  return `Draw: ${s.length > 0 ? s : 'a friendly little monster'}`
}

export const INVENT_PROMPT_SYSTEM = [
  'You write a single short, funny, drawable prompt for a doodle party game — the',
  'kind of silly scene the next player will have to draw. Output ONLY the prompt:',
  '3 to 8 words, lowercase, no quotes, no trailing punctuation. Make it concrete',
  'and visual — a character or object doing something — never abstract.',
].join('\n')

export function buildInventPromptUser(seed: number): string {
  // Vary the nudge so repeated calls in a room don't collapse to one idea.
  const nudges = ['an animal', 'a food', 'a robot or machine', 'a monster', 'a everyday object', 'a job or hobby']
  return `Write one fresh prompt featuring ${pick(nudges, seed)}. Do not reuse common examples.`
}

// --- Output parsing / validation --------------------------------------------

/**
 * Validate + normalize an LLM drawing response into a strokes JSON string, or
 * null if it isn't usable (→ the DO falls back to a canned doodle). Tolerates
 * stray prose / code fences by extracting the outer JSON array. The engine's
 * `clampDrawing` is the authoritative sanitizer (colors, widths, point bounds),
 * so this only needs to confirm a well-formed, non-empty array of strokes.
 */
export function parseStrokesJson(raw: string): string | null {
  if (!raw) return null
  const start = raw.indexOf('[')
  const end = raw.lastIndexOf(']')
  if (start < 0 || end <= start) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw.slice(start, end + 1))
  } catch {
    return null
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return null
  const usable = parsed.some(
    (st) =>
      !!st &&
      typeof st === 'object' &&
      Array.isArray((st as { points?: unknown }).points) &&
      ((st as { points: unknown[] }).points.length >= 4),
  )
  return usable ? JSON.stringify(parsed) : null
}

/** Trim an LLM one-liner into a clean prompt/guess, or '' if empty (→ fallback). */
export function sanitizeBotLine(raw: string): string {
  return raw
    .replace(/^["'`\s]+|["'`\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_TEXT_LENGTH)
}

// --- Budget counter math (for the daily-cap DO) -----------------------------

/** A single budget cell: the UTC day it covers + how many generations were used. */
export interface BudgetCell {
  day: string
  used: number
}

/**
 * Pure counter math for the daily budget DO (extracted so it's unit-testable
 * without a DO runtime). Resets to 0 when the stored cell is from an earlier UTC
 * day; denies when adding `n` would exceed `cap`. On deny the cell is returned
 * rolled to today with its count unchanged, so `used` never overcounts.
 */
export function tryReserve(
  cur: BudgetCell | undefined,
  day: string,
  n: number,
  cap: number,
): { cell: BudgetCell; allowed: boolean } {
  const used = cur && cur.day === day ? cur.used : 0
  if (used + n > cap) return { cell: { day, used }, allowed: false }
  return { cell: { day, used: used + n }, allowed: true }
}
