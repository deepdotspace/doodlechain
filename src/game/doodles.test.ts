import { describe, expect, it } from 'vitest'
import DOODLES_DATA from './doodles.data.json'
import { ALIAS, botDoodle, matchCategory } from './doodles'
import { botGuess, botPrompt } from './bots'

const CATS = new Set(Object.keys(DOODLES_DATA as Record<string, unknown>))

function assertValidDrawing(json: string) {
  const arr = JSON.parse(json)
  expect(Array.isArray(arr)).toBe(true)
  expect(arr.length).toBeGreaterThan(0)
  for (const s of arr) {
    expect(typeof s.color).toBe('string')
    expect(s.width).toBeGreaterThan(0)
    expect(Array.isArray(s.points)).toBe(true)
    expect(s.points.length).toBeGreaterThanOrEqual(2)
    expect(s.points.length % 2).toBe(0)
    for (const n of s.points) {
      expect(n).toBeGreaterThanOrEqual(0)
      expect(n).toBeLessThanOrEqual(1)
    }
  }
}

describe('the shipped doodle pack', () => {
  it('has a healthy number of categories, each with doodles', () => {
    expect(CATS.size).toBeGreaterThan(100)
    for (const cat of CATS) {
      const drawings = (DOODLES_DATA as Record<string, number[][][]>)[cat]
      expect(drawings.length).toBeGreaterThan(0)
    }
  })
})

describe('matchCategory', () => {
  it('matches the subject noun in a freeform prompt', () => {
    expect(matchCategory('a cat DJing at a party')).toBe('cat')
    expect(matchCategory('a snowman on vacation')).toBe('snowman')
  })

  it('picks the earliest noun (usually the subject) when several match', () => {
    // "owl" appears before "pizza"; the subject wins.
    expect(matchCategory('an owl delivering pizza')).toBe('owl')
  })

  it('only ever returns a category that exists in the pack', () => {
    for (const p of ['a duck running for president', 'a spider knitting a sweater', 'a banana riding a bicycle']) {
      const m = matchCategory(p)
      if (m !== null) expect(CATS.has(m)).toBe(true)
    }
  })

  it('returns null when no noun matches (→ caller uses a random doodle)', () => {
    expect(matchCategory('the meaning of everything')).toBeNull()
    expect(matchCategory('')).toBeNull()
  })
})

describe('pack invariants (guard against a silently-degraded pack)', () => {
  it('every ALIAS target is a real category in the pack', () => {
    for (const target of Object.values(ALIAS)) {
      expect(CATS.has(target), `alias target "${target}" missing from pack`).toBe(true)
    }
  })

  it('every canned bot prompt and guess resolves to an in-pack doodle', () => {
    // botPrompt/botGuess cycle their lists by seed, so 0..23 covers all entries.
    for (let i = 0; i < 24; i++) {
      for (const line of [botPrompt(i), botGuess(i)]) {
        const cat = matchCategory(line)
        expect(cat, `"${line}" should match a real category`).not.toBeNull()
        expect(CATS.has(cat!), `"${line}" -> "${cat}" not in pack`).toBe(true)
      }
    }
  })
})

describe('botDoodle', () => {
  it('returns a valid wire-format drawing for a matched prompt', () => {
    assertValidDrawing(botDoodle('a cat DJing at a party', 3))
  })

  it('returns a valid drawing even for an unmatched (abstract) prompt', () => {
    assertValidDrawing(botDoodle('xyzzy frobnicate zork', 9))
  })

  it('is deterministic in its seed', () => {
    expect(botDoodle('a dog walking a snail', 42)).toBe(botDoodle('a dog walking a snail', 42))
  })
})
