import { describe, expect, it } from 'vitest'
import {
  assignedChainOrder,
  holderSeatForChain,
  isDrawingRound,
  phaseForRound,
} from './rotation'

describe('chain rotation', () => {
  it('round parity: round 0 is the prompt, odd draws, even guesses', () => {
    expect(isDrawingRound(1)).toBe(true)
    expect(isDrawingRound(2)).toBe(false)
    expect(phaseForRound(1)).toBe('DRAW')
    expect(phaseForRound(2)).toBe('GUESS')
    expect(phaseForRound(3)).toBe('DRAW')
  })

  it('each player draws their own prompt in round 1, the other stack in round 2', () => {
    // N = 2
    expect(assignedChainOrder(0, 1, 2)).toBe(0)
    expect(assignedChainOrder(1, 1, 2)).toBe(1)
    expect(assignedChainOrder(0, 2, 2)).toBe(1)
    expect(assignedChainOrder(1, 2, 2)).toBe(0)
  })

  it('4-player chains visit every player exactly once with no per-round collisions', () => {
    const N = 4
    // visits[chainOrder][round] = seat
    const visits: number[][] = Array.from({ length: N }, () => [])
    for (let r = 1; r <= N; r++) {
      const assigned = new Set<number>()
      for (let p = 0; p < N; p++) {
        const co = assignedChainOrder(p, r, N)
        expect(assigned.has(co)).toBe(false) // no two players share a chain
        assigned.add(co)
        visits[co][r] = p
      }
      expect(assigned.size).toBe(N)
    }
    for (let c = 0; c < N; c++) {
      const visitedBy = new Set<number>()
      for (let r = 1; r <= N; r++) visitedBy.add(visits[c][r])
      expect(visitedBy.size).toBe(N) // every seat visits chain c exactly once
    }
  })

  it('holderSeatForChain is the inverse of assignedChainOrder', () => {
    for (const N of [2, 4, 5, 8, 10]) {
      for (let r = 1; r <= N; r++) {
        for (let p = 0; p < N; p++) {
          const co = assignedChainOrder(p, r, N)
          expect(holderSeatForChain(co, r, N)).toBe(p)
        }
      }
    }
  })

  it('attributes a chain in a given round to the responsible seat', () => {
    // Chain 0 in round 2 with N=4 is held by seat (0 + 2 - 1) mod 4 = 1.
    expect(holderSeatForChain(0, 2, 4)).toBe(1)
    // Chain 3 in round 1 is held by its owner, seat 3.
    expect(holderSeatForChain(3, 1, 4)).toBe(3)
  })
})
