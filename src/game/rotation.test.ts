import { describe, expect, it } from 'vitest'
import {
  assignedChainOrder,
  holderSeatForChain,
  isDrawingRound,
  phaseForRound,
  totalRounds,
} from './rotation'

/** Every seat count a real room can reach (MIN_PLAYERS 2 .. MAX_PLAYERS 10). */
const SEAT_COUNTS = [2, 3, 4, 5, 6, 7, 8, 9, 10]

describe('chain rotation', () => {
  it('round parity: round 0 is the prompt, odd draws, even guesses', () => {
    expect(isDrawingRound(1)).toBe(true)
    expect(isDrawingRound(2)).toBe(false)
    expect(phaseForRound(1)).toBe('DRAW')
    expect(phaseForRound(2)).toBe('GUESS')
    expect(phaseForRound(3)).toBe('DRAW')
  })

  it('plays one round per seat that is NOT the chain owner', () => {
    expect(totalRounds(2)).toBe(1) // a single DRAW, no GUESS
    expect(totalRounds(3)).toBe(2)
    expect(totalRounds(4)).toBe(3)
    expect(totalRounds(10)).toBe(9)
  })

  it('degenerates safely below two seats instead of handing a prompt back', () => {
    expect(totalRounds(1)).toBe(0)
    expect(totalRounds(0)).toBe(0)
    expect(totalRounds(-3)).toBe(0)
    // n <= 0 must not produce NaN / negative indexes.
    expect(assignedChainOrder(0, 1, 0)).toBe(0)
    expect(holderSeatForChain(0, 1, 0)).toBe(0)
  })

  /**
   * THE invariant that was missing and let the bug ship: a player must never be
   * assigned the chain they seeded. Getting your own prompt back to draw is the
   * one thing a drawing-telephone game must never do.
   */
  it('never assigns a seat its own chain, in any round, at any seat count', () => {
    for (const n of SEAT_COUNTS) {
      for (let r = 1; r <= totalRounds(n); r++) {
        for (let seat = 0; seat < n; seat++) {
          expect(
            assignedChainOrder(seat, r, n),
            `seat ${seat} was handed its own chain in round ${r} of an ${n}-player game`,
          ).not.toBe(seat)
        }
      }
    }
  })

  it('never lets a chain be held by its owner, in any round', () => {
    for (const n of SEAT_COUNTS) {
      for (let r = 1; r <= totalRounds(n); r++) {
        for (let chain = 0; chain < n; chain++) {
          expect(holderSeatForChain(chain, r, n)).not.toBe(chain)
        }
      }
    }
  })

  it('round 1 passes each stack one seat forward (the owner never draws it)', () => {
    // N = 2: the only round is a DRAW, and each player draws the OTHER prompt.
    expect(assignedChainOrder(0, 1, 2)).toBe(1)
    expect(assignedChainOrder(1, 1, 2)).toBe(0)
    // N = 4: seat P draws chain P-1.
    expect(assignedChainOrder(0, 1, 4)).toBe(3)
    expect(assignedChainOrder(1, 1, 4)).toBe(0)
    expect(assignedChainOrder(2, 1, 4)).toBe(1)
    expect(assignedChainOrder(3, 1, 4)).toBe(2)
  })

  it('every seat touches every chain but its own, exactly once', () => {
    for (const n of SEAT_COUNTS) {
      for (let seat = 0; seat < n; seat++) {
        const touched = new Set<number>()
        for (let r = 1; r <= totalRounds(n); r++) touched.add(assignedChainOrder(seat, r, n))
        expect(touched.size).toBe(totalRounds(n)) // no chain twice
        expect(touched.has(seat)).toBe(false) // and never its own
        for (let c = 0; c < n; c++) {
          if (c !== seat) expect(touched.has(c)).toBe(true)
        }
      }
    }
  })

  it('every chain is held by every seat but its owner, exactly once', () => {
    for (const n of SEAT_COUNTS) {
      for (let chain = 0; chain < n; chain++) {
        const holders = new Set<number>()
        for (let r = 1; r <= totalRounds(n); r++) holders.add(holderSeatForChain(chain, r, n))
        expect(holders.size).toBe(totalRounds(n))
        expect(holders.has(chain)).toBe(false)
        for (let seat = 0; seat < n; seat++) {
          if (seat !== chain) expect(holders.has(seat)).toBe(true)
        }
      }
    }
  })

  it('no two seats ever share a chain in the same round', () => {
    for (const n of SEAT_COUNTS) {
      for (let r = 1; r <= totalRounds(n); r++) {
        const assigned = new Set<number>()
        for (let seat = 0; seat < n; seat++) {
          const co = assignedChainOrder(seat, r, n)
          expect(assigned.has(co)).toBe(false)
          assigned.add(co)
        }
        expect(assigned.size).toBe(n)
      }
    }
  })

  it('holderSeatForChain is the inverse of assignedChainOrder', () => {
    for (const n of SEAT_COUNTS) {
      for (let r = 1; r <= totalRounds(n); r++) {
        for (let seat = 0; seat < n; seat++) {
          const co = assignedChainOrder(seat, r, n)
          expect(holderSeatForChain(co, r, n)).toBe(seat)
        }
      }
    }
  })

  it('attributes a chain in a given round to the responsible seat', () => {
    // Chain 0 in round 2 with N=4 is held by seat (0 + 2) mod 4 = 2.
    expect(holderSeatForChain(0, 2, 4)).toBe(2)
    // Chain 3 in round 1 has moved one seat forward, to seat 0 — NOT its owner.
    expect(holderSeatForChain(3, 1, 4)).toBe(0)
  })

  it('hand-verified 4-player assignment table (seat -> chain per round)', () => {
    // Chains seeded: seat0->chain0, seat1->chain1, seat2->chain2, seat3->chain3.
    // R1 DRAW  R2 GUESS  R3 DRAW   (3 rounds = 4 seats - 1)
    const expected = [
      /* round 1 */ [3, 0, 1, 2],
      /* round 2 */ [2, 3, 0, 1],
      /* round 3 */ [1, 2, 3, 0],
    ]
    for (let r = 1; r <= 3; r++) {
      for (let seat = 0; seat < 4; seat++) {
        expect(assignedChainOrder(seat, r, 4)).toBe(expected[r - 1][seat])
      }
    }
  })

  it('hand-verified 3-player assignment table (seat -> chain per round)', () => {
    // R1 DRAW  R2 GUESS   (2 rounds = 3 seats - 1)
    const expected = [
      /* round 1 */ [2, 0, 1],
      /* round 2 */ [1, 2, 0],
    ]
    for (let r = 1; r <= 2; r++) {
      for (let seat = 0; seat < 3; seat++) {
        expect(assignedChainOrder(seat, r, 3)).toBe(expected[r - 1][seat])
      }
    }
  })
})
