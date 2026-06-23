/**
 * Bot content — fully offline, zero-cost, zero-latency. Bots exist to fill a
 * room to the minimum and to make solo testing of the full chain possible; they
 * are NOT the headline feature, so they don't burn owner credits on an LLM.
 * They write from canned word-banks and scribble a few procedural strokes.
 *
 * Pure module (no SDK): the DO (AppGameRoom) imports these to stage bot inputs.
 */

import type { Stroke } from './types'

const BOT_NAMES = [
  'Pixel',
  'Doodlebot',
  'Scribbles',
  'Inkling',
  'Sketchy',
  'Crayon',
  'Marker',
  'Smudge',
]

export function botName(i: number): string {
  return BOT_NAMES[i % BOT_NAMES.length]
}

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
 * A small procedural doodle as a JSON strokes string, matching the canvas wire
 * format: an array of { color, width, points:[x0,y0,x1,y1,...] } in 0..1 space.
 * Draws a loose blobby creature so the slideshow has something to show.
 */
export function botDrawing(seed: number): string {
  const colors = ['#e8553b', '#2d8a6d', '#3b6fd4', '#c0418f', '#f2a93b', '#7a52d6']
  const c = colors[Math.abs(seed) % colors.length]
  const cx = 0.4 + ((Math.abs(seed) % 20) / 100)
  const cy = 0.45 + ((Math.abs(seed >> 2) % 20) / 100)
  const r = 0.18

  // Body: a closed-ish circle approximated by a polyline.
  const body: number[] = []
  for (let a = 0; a <= Math.PI * 2 + 0.2; a += Math.PI / 8) {
    body.push(round(cx + Math.cos(a) * r), round(cy + Math.sin(a) * r * 0.85))
  }
  const strokes: Stroke[] = [
    { color: c, width: 7, points: body },
    // Two eyes.
    { color: '#1c1a17', width: 6, points: [round(cx - 0.06), round(cy - 0.04), round(cx - 0.06), round(cy - 0.03)] },
    { color: '#1c1a17', width: 6, points: [round(cx + 0.06), round(cy - 0.04), round(cx + 0.06), round(cy - 0.03)] },
    // A smile.
    { color: '#1c1a17', width: 5, points: [round(cx - 0.07), round(cy + 0.05), round(cx), round(cy + 0.09), round(cx + 0.07), round(cy + 0.05)] },
  ]
  return JSON.stringify(strokes)
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000
}
