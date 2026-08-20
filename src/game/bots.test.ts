import { describe, expect, it } from 'vitest'
import { botGuess, botPrompt, botTurn } from './bots'
import { assignedChainOrder } from './rotation'
import { createInitialState } from './engine'
import type { Chain, GameState, PlayerState } from './types'

describe('canned bot lines', () => {
  it('prompt + guess are stable, non-empty strings for any seed', () => {
    for (const seed of [0, 1, 7, 123456, -42]) {
      expect(botPrompt(seed).length).toBeGreaterThan(0)
      expect(botGuess(seed).length).toBeGreaterThan(0)
    }
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

  it('draws the OTHER seat\'s prompt, never the one it wrote itself', () => {
    const { s, bot } = drawStateWithBot()
    const turn = botTurn(s, bot)
    // The bot owns chain 0 ('a shy volcano'). In round 1 of a 2-seat game the
    // stack passes forward, so it must be handed Ada's chain instead.
    expect(turn).toEqual({ phase: 'DRAW', round: 1, source: 'a sleepy sun' })
    expect(assignedChainOrder(0, 1, 2)).toBe(1)
  })

  it('returns null once the bot has already submitted this round', () => {
    const { s, bot } = drawStateWithBot()
    // The bot's assigned chain in round 1 is chain 1, not its own chain 0.
    s.chains[1].steps[1] = { round: 1, type: 'drawing', authorCid: 'bot-1', authorName: 'Pixel', content: '[]' }
    expect(botTurn(s, bot)).toBeNull()
  })

  it('is NOT considered done just because its own chain already has the round', () => {
    const { s, bot } = drawStateWithBot()
    // Ada drew the bot's chain this round. That must not satisfy the bot's turn.
    s.chains[0].steps[1] = { round: 1, type: 'drawing', authorCid: 'cidH', authorName: 'Ada', content: '[]' }
    expect(botTurn(s, bot)).toEqual({ phase: 'DRAW', round: 1, source: 'a sleepy sun' })
  })

  it('writes its own chain in PROMPT (round 0 is the one round you own)', () => {
    const { s, bot } = drawStateWithBot()
    s.phase = 'PROMPT'
    s.round = 0
    s.chains[0].steps = {}
    s.chains[1].steps = {}
    expect(botTurn(s, bot)).toEqual({ phase: 'PROMPT', round: 0, source: '' })
  })

  it('returns null when not seated / not in an active phase', () => {
    const { s, bot } = drawStateWithBot()
    const unseated: PlayerState = { ...bot, cid: 'ghost' }
    expect(botTurn(s, unseated)).toBeNull()
    s.phase = 'LOBBY'
    expect(botTurn(s, bot)).toBeNull()
  })
})
