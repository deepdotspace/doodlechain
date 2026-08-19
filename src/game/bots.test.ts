import { describe, expect, it } from 'vitest'
import { botGuess, botPrompt, botTurn } from './bots'
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
