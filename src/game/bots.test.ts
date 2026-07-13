import { describe, expect, it } from 'vitest'
import {
  DAILY_BOT_CAP,
  botTurn,
  parseStrokesJson,
  sanitizeBotLine,
  tryReserve,
  type BudgetCell,
} from './bots'
import { createInitialState } from './engine'
import type { Chain, GameState, PlayerState } from './types'

describe('parseStrokesJson (untrusted LLM drawing output)', () => {
  it('accepts a well-formed strokes array', () => {
    const raw = '[{"color":"#e8553b","width":6,"points":[0.2,0.2,0.6,0.7]}]'
    const out = parseStrokesJson(raw)
    expect(out).not.toBeNull()
    expect(JSON.parse(out!)).toHaveLength(1)
  })

  it('extracts the array from prose / markdown fences around it', () => {
    const raw = 'Sure! Here is the drawing:\n```json\n[{"color":"#000","width":4,"points":[0.1,0.1,0.5,0.5,0.8,0.2]}]\n```\nEnjoy!'
    const out = parseStrokesJson(raw)
    expect(out).not.toBeNull()
    expect(JSON.parse(out!)[0].points).toHaveLength(6)
  })

  it('rejects non-JSON, empty arrays, and arrays with no usable stroke', () => {
    expect(parseStrokesJson('')).toBeNull()
    expect(parseStrokesJson('I cannot draw that.')).toBeNull()
    expect(parseStrokesJson('[]')).toBeNull()
    expect(parseStrokesJson('[{"color":"#000","width":4}]')).toBeNull() // no points
    expect(parseStrokesJson('[{"points":[0.1,0.1]}]')).toBeNull() // < 2 points (needs >= 4 numbers)
  })
})

describe('sanitizeBotLine', () => {
  it('strips surrounding quotes/whitespace and collapses runs', () => {
    expect(sanitizeBotLine('  "a happy   cloud"  ')).toBe('a happy cloud')
    expect(sanitizeBotLine('`a robot`')).toBe('a robot')
  })
  it('caps at the max text length', () => {
    const long = 'a '.repeat(80)
    expect(sanitizeBotLine(long).length).toBeLessThanOrEqual(80)
  })
  it('returns empty for empty-ish input (→ caller falls back)', () => {
    expect(sanitizeBotLine('   ')).toBe('')
  })
})

describe('tryReserve (daily budget math)', () => {
  const DAY = '2026-07-13'
  it('allows and increments under the cap', () => {
    const r = tryReserve(undefined, DAY, 1, DAILY_BOT_CAP)
    expect(r.allowed).toBe(true)
    expect(r.cell).toEqual({ day: DAY, used: 1 })
  })
  it('resets when the stored cell is from an earlier day', () => {
    const r = tryReserve({ day: '2026-07-12', used: DAILY_BOT_CAP }, DAY, 1, DAILY_BOT_CAP)
    expect(r.allowed).toBe(true)
    expect(r.cell.used).toBe(1)
  })
  it('denies (unchanged count) the reservation that would exceed the cap', () => {
    const full: BudgetCell = { day: DAY, used: DAILY_BOT_CAP }
    const r = tryReserve(full, DAY, 1, DAILY_BOT_CAP)
    expect(r.allowed).toBe(false)
    expect(r.cell.used).toBe(DAILY_BOT_CAP)
  })
})

describe('botTurn', () => {
  function drawStateWithBot(): { s: GameState; bot: PlayerState } {
    const s = createInitialState()
    s.phase = 'DRAW'
    s.round = 1
    s.seatCount = 2
    const promptStep = { round: 0, type: 'prompt' as const, authorCid: 'bot-1', authorName: 'Pixel', content: 'a shy volcano' }
    s.chains = [
      { order: 0, ownerCid: 'bot-1', ownerName: 'Pixel', steps: { 0: promptStep } },
      { order: 1, ownerCid: 'cidH', ownerName: 'Ada', steps: { 0: { ...promptStep, authorCid: 'cidH', content: 'a sleepy sun' } } },
    ] as Chain[]
    const bot: PlayerState = {
      userId: 'bot-1', cid: 'bot-1', name: 'Pixel', color: '#e8553b',
      isHost: false, connected: true, joinedAt: 1, isBot: true,
    }
    s.players = { 'bot-1': bot }
    return { s, bot }
  }

  it('reports the drawing turn + the source to draw for a seated bot', () => {
    const { s, bot } = drawStateWithBot()
    const turn = botTurn(s, bot)
    expect(turn).toEqual({ phase: 'DRAW', round: 1, source: 'a shy volcano' })
  })

  it('returns null once the bot has already submitted this round', () => {
    const { s, bot } = drawStateWithBot()
    s.chains[0].steps[1] = { round: 1, type: 'drawing', authorCid: 'bot-1', authorName: 'Pixel', content: '[]' }
    expect(botTurn(s, bot)).toBeNull()
  })

  it('returns null when not seated / not in an active phase', () => {
    const { s, bot } = drawStateWithBot()
    const unseated: PlayerState = { ...bot, cid: 'ghost' }
    expect(botTurn(s, unseated)).toBeNull()
    s.phase = 'LOBBY'
    expect(botTurn(s, bot)).toBeNull()
  })
})
