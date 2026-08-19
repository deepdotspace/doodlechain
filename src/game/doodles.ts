/**
 * Doodle library for bots — real human doodles instead of AI-generated scribbles.
 *
 * Bots don't ask an LLM to invent stroke coordinates anymore (that renders as
 * unrecognizable noise for anything that isn't a box). Instead we ship a curated
 * pack of Google "Quick, Draw!" doodles — real people's 15-second sketches,
 * already in this app's vector-stroke space — and a bot serves one that matches
 * the noun in the prompt it's meant to draw. Recognizable, free, no network.
 *
 * `doodles.data.json` is the packed pack (built by scripts/build-doodles.mjs):
 *   { "<category>": [ drawing, ... ] }, drawing = [ stroke, ... ], stroke = [x,y,x,y,...] in 0..1.
 * Ink colour + width are applied here at read time. This module is the ONLY
 * importer of the pack, so the ~1MB asset stays out of the client bundle.
 *
 * Doodle data: Google "Quick, Draw!" dataset, CC BY 4.0 (see CREDITS.md).
 */

import DOODLES_DATA from './doodles.data.json'
import { botDrawing } from './bots'
import type { Stroke } from './types'

/** category -> list of drawings; drawing -> list of strokes; stroke -> [x,y,x,y,...] (0..1). */
const DOODLES = DOODLES_DATA as Record<string, number[][][]>
const CATEGORIES = Object.keys(DOODLES)
const MULTIWORD = CATEGORIES.filter((c) => c.includes(' '))
const CATSET = new Set(CATEGORIES)

/** Colourful-but-dark inks so a doodle reads clearly on paper white. */
const INKS = ['#1c1a17', '#2d5aa0', '#b5432f', '#2f7d4f', '#7a4fb0', '#b07d1f', '#c0418f']
const WIDTH = 7

/**
 * Common game nouns that aren't Quick,Draw! categories -> the nearest one we have.
 * Every value MUST be a key in the pack (a doodles.test.ts invariant), else the
 * prompt silently falls back to a random doodle instead of the intended one.
 * Exported so the test can assert that invariant.
 */
export const ALIAS: Record<string, string> = {
  kitty: 'cat', kitten: 'cat', puppy: 'dog', doggo: 'dog', bunny: 'rabbit', unicorn: 'horse',
  pony: 'horse', birdie: 'bird', froggy: 'frog', piggy: 'pig', bike: 'bicycle', unicycle: 'bicycle',
  auto: 'car', jet: 'airplane', plane: 'airplane', chopper: 'helicopter', boat: 'sailboat',
  ship: 'sailboat', bulb: 'light bulb', shades: 'eyeglasses', glasses: 'eyeglasses', specs: 'eyeglasses',
  smartphone: 'cell phone', phone: 'cell phone', tv: 'television', pc: 'computer', shroom: 'mushroom',
  burger: 'hamburger', fries: 'potato', hotdog: 'hot dog', pineapples: 'pineapple',
}

const singular = (w: string): string =>
  w.endsWith('ies') ? w.slice(0, -3) + 'y' : w.endsWith('sses') ? w.slice(0, -2) : w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w

function wordIndex(text: string, phrase: string): number {
  const m = new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).exec(text)
  return m ? m.index : -1
}

/**
 * Best Quick,Draw! category for a freeform prompt, or null if nothing matches.
 * Picks the EARLIEST noun in the prompt (usually the subject), preferring a
 * longer multi-word category over a shorter word at the same spot. Pure.
 */
export function matchCategory(prompt: string): string | null {
  const clean = prompt.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
  if (!clean) return null
  const hits: Array<{ cat: string; index: number; len: number }> = []

  for (const cat of MULTIWORD) {
    const idx = wordIndex(clean, cat)
    if (idx >= 0) hits.push({ cat, index: idx, len: cat.length })
  }
  let pos = 0
  for (const w of clean.split(' ')) {
    const at = clean.indexOf(w, pos)
    pos = at + w.length
    const s = singular(w)
    if (CATSET.has(w)) hits.push({ cat: w, index: at, len: w.length })
    else if (CATSET.has(s)) hits.push({ cat: s, index: at, len: s.length })
    else if (ALIAS[w]) hits.push({ cat: ALIAS[w], index: at, len: w.length })
    else if (ALIAS[s]) hits.push({ cat: ALIAS[s], index: at, len: s.length })
  }
  if (hits.length === 0) return null
  hits.sort((a, b) => a.index - b.index || b.len - a.len)
  return hits[0].cat
}

/**
 * A bot's drawing for a prompt, as a strokes-JSON string in the canvas wire
 * format. Matches the prompt's noun to a real human doodle; an unmatched
 * (abstract) prompt falls back to a random real doodle — on-theme drift in a
 * telephone-draw game — and a truly empty pack falls back to the canned blob.
 * Deterministic in `seed`, so it's stable across re-ticks.
 */
export function botDoodle(prompt: string, seed: number): string {
  const cat = matchCategory(prompt) ?? (CATEGORIES.length ? CATEGORIES[seed % CATEGORIES.length] : null)
  const drawings = cat ? DOODLES[cat] : null
  if (!drawings || drawings.length === 0) return botDrawing(seed)

  const drawing = drawings[seed % drawings.length]
  const ink = INKS[seed % INKS.length]
  const strokes: Stroke[] = drawing.map((points) => ({ color: ink, width: WIDTH, points }))
  return JSON.stringify(strokes)
}
