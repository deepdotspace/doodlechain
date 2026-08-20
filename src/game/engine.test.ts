import { describe, expect, it } from 'vitest'
import { createInitialState, reduce, roster } from './engine'
import type { Chain, EngineInput, GameState, RosterEntry } from './types'
import { assignedChainOrder, totalRounds } from './rotation'

// --- Test helpers ----------------------------------------------------------

type Conn = { userId: string; cid: string; name: string }

function rosterOf(conns: Conn[]): RosterEntry[] {
  return conns.map((c) => ({ userId: c.userId, userName: c.name }))
}

/** Apply inputs at `now`, returning the next state (or the prev if no change). */
function step(
  state: GameState,
  conns: Conn[],
  inputs: EngineInput[],
  now: number,
): GameState {
  return reduce(state, inputs, now, rosterOf(conns)) ?? state
}

function setName(c: Conn): EngineInput {
  return { userId: c.userId, action: 'SET_NAME', data: { name: c.name, cid: c.cid } }
}

function makeConns(n: number): Conn[] {
  return Array.from({ length: n }, (_, i) => ({
    userId: `u${i}`,
    cid: `cid${i}`,
    name: `Player${i}`,
  }))
}

/** Join everyone, name them, claim host (conn 0), and BEGIN. Returns started state. */
function startedGame(n: number, t0 = 1000): { state: GameState; conns: Conn[] } {
  const conns = makeConns(n)
  let s = createInitialState()
  s = step(s, conns, conns.map(setName), t0)
  s = step(s, conns, [{ userId: 'u0', action: 'CLAIM_HOST', data: {} }], t0 + 1)
  s = step(s, conns, [{ userId: 'u0', action: 'BEGIN', data: {} }], t0 + 2)
  return { state: s, conns }
}

// --- Tests -----------------------------------------------------------------

describe('lobby', () => {
  it('seats connected, named players and lets the host start', () => {
    const conns = makeConns(3)
    let s = createInitialState()
    s = step(s, conns, conns.map(setName), 1000)
    expect(roster(s)).toHaveLength(3)
    s = step(s, conns, [{ userId: 'u0', action: 'CLAIM_HOST', data: {} }], 1001)
    expect(s.hostCid).toBe('cid0')
    // Non-host cannot start.
    s = step(s, conns, [{ userId: 'u1', action: 'BEGIN', data: {} }], 1002)
    expect(s.phase).toBe('LOBBY')
    // Host starts.
    s = step(s, conns, [{ userId: 'u0', action: 'BEGIN', data: {} }], 1003)
    expect(s.phase).toBe('PROMPT')
    expect(s.seatCount).toBe(3)
    expect(s.chains).toHaveLength(3)
  })

  it('refuses to start below the minimum player count', () => {
    const conns = makeConns(1)
    let s = createInitialState()
    s = step(s, conns, conns.map(setName), 1000)
    s = step(s, conns, [{ userId: 'u0', action: 'CLAIM_HOST', data: {} }], 1001)
    s = step(s, conns, [{ userId: 'u0', action: 'BEGIN', data: {} }], 1002)
    expect(s.phase).toBe('LOBBY')
  })
})

describe('full game flow', () => {
  it('PROMPT advances to round-1 DRAW once everyone has written a prompt', () => {
    const { state, conns } = startedGame(3)
    let s = state
    expect(s.phase).toBe('PROMPT')
    const prompts = conns.map((c) => ({
      userId: c.userId,
      action: 'SUBMIT_PROMPT',
      data: { text: `${c.name} prompt` },
    }))
    s = step(s, conns, prompts, 2000)
    expect(s.phase).toBe('DRAW')
    expect(s.round).toBe(1)
    // Each chain has its owner's prompt at step 0.
    for (let i = 0; i < 3; i++) {
      expect(s.chains[i].steps[0].type).toBe('prompt')
      expect(s.chains[i].steps[0].content).toBe(`Player${i} prompt`)
    }
  })

  it('runs a clean 3-player game end-to-end to the slideshow and DONE', () => {
    const N = 3
    let { state: s, conns } = startedGame(N)
    let now = 2000

    // PROMPT (round 0)
    s = step(
      s,
      conns,
      conns.map((c) => ({ userId: c.userId, action: 'SUBMIT_PROMPT', data: { text: `${c.name}-seed` } })),
      now,
    )
    expect(s.phase).toBe('DRAW')

    // Rounds 1..N-1: each connected player submits on their assigned chain.
    for (let round = 1; round <= totalRounds(N); round++) {
      now += 1000
      const action = s.phase === 'DRAW' ? 'SUBMIT_DRAWING' : 'SUBMIT_GUESS'
      const inputs = conns.map((c, i) => {
        if (action === 'SUBMIT_DRAWING') {
          return { userId: c.userId, action, data: { strokes: `[{"seat":${i},"r":${round}}]` } }
        }
        return { userId: c.userId, action, data: { text: `guess-s${i}-r${round}` } }
      })
      s = step(s, conns, inputs, now)
    }

    expect(s.phase).toBe('REVEAL')
    // Every chain has a full set of steps 0..N-1 — the prompt plus one
    // contribution from each of the OTHER N-1 seats. Nothing from its owner.
    for (const chain of s.chains) {
      for (let r = 0; r <= totalRounds(N); r++) expect(chain.steps[r]).toBeDefined()
      expect(chain.steps[totalRounds(N) + 1]).toBeUndefined()
      expect(chain.steps[0].skipped).toBeUndefined()
      expect(chain.steps[0].authorCid).toBe(chain.ownerCid)
      for (let r = 1; r <= totalRounds(N); r++) {
        expect(chain.steps[r].authorCid).not.toBe(chain.ownerCid)
      }
    }

    // Host clicks through the whole slideshow → DONE.
    let guard = 0
    while (s.phase === 'REVEAL' && guard++ < 200) {
      now += 100
      s = step(s, conns, [{ userId: 'u0', action: 'REVEAL_NEXT', data: {} }], now)
    }
    expect(s.phase).toBe('DONE')

    // Play again returns to lobby with seats cleared.
    s = step(s, conns, [{ userId: 'u0', action: 'BEGIN', data: {} }], now + 1)
    expect(s.phase).toBe('LOBBY')
    expect(s.chains).toHaveLength(0)
  })
})

describe('server-authoritative timers (no client needed to advance)', () => {
  it('advances PROMPT on timeout even when nobody submits, synthesizing seeds', () => {
    const { state, conns } = startedGame(3)
    const endsAt = state.phaseEndsAt!
    // Tick once well past the deadline with NO inputs at all.
    const s = step(state, conns, [], endsAt + 1)
    expect(s.phase).toBe('DRAW')
    expect(s.round).toBe(1)
    for (const chain of s.chains) {
      expect(chain.steps[0]).toBeDefined()
      expect(chain.steps[0].skipped).toBe(true)
      expect(chain.steps[0].content.length).toBeGreaterThan(0)
    }
  })

  it('a disconnected player does not stall the round — placeholder fills the gap', () => {
    const N = 3
    let { state: s, conns } = startedGame(N)
    // Everyone writes a prompt.
    s = step(
      s,
      conns,
      conns.map((c) => ({ userId: c.userId, action: 'SUBMIT_PROMPT', data: { text: `${c.name}` } })),
      2000,
    )
    expect(s.phase).toBe('DRAW')

    // Player 2 drops. Remaining two draw; the round should still resolve on timeout.
    const remaining = conns.slice(0, 2)
    const drawInputs = remaining.map((c) => ({
      userId: c.userId,
      action: 'SUBMIT_DRAWING',
      data: { strokes: '[]' },
    }))
    s = step(s, remaining, drawInputs, 3000)
    // Not everyone submitted yet (the dropped seat is missing), so still DRAW...
    expect(s.phase).toBe('DRAW')
    // ...until the timer expires, which synthesizes the missing drawing.
    s = step(s, remaining, [], s.phaseEndsAt! + 1)
    expect(s.phase).toBe('GUESS')
    expect(s.round).toBe(2)
    // The dropped seat's chain still got a (skipped) drawing this round.
    const missing = s.chains.find((c) => c.steps[1]?.skipped)
    expect(missing).toBeDefined()
  })
})

describe('last-second submit (auto-save on timeout)', () => {
  it('preserves a drawing submitted on the very tick the phase times out', () => {
    const N = 3
    let { state: s, conns } = startedGame(N)
    // Everyone writes a prompt → round-1 DRAW.
    s = step(
      s,
      conns,
      conns.map((c) => ({ userId: c.userId, action: 'SUBMIT_PROMPT', data: { text: c.name } })),
      2000,
    )
    expect(s.phase).toBe('DRAW')

    // u0 auto-submits its in-progress drawing in the SAME tick the timer expires
    // (now === phaseEndsAt). The reducer applies inputs before synthesizing, so
    // the real drawing must win over a skipped placeholder.
    const deadline = s.phaseEndsAt!
    s = step(
      s,
      conns,
      [{ userId: 'u0', action: 'SUBMIT_DRAWING', data: { strokes: '[{"color":"#1c1a17","width":6,"points":[0.1,0.1,0.4,0.4]}]' } }],
      deadline,
    )

    // Phase advanced on the timeout, but the chain u0 was assigned (seat 0 draws
    // chain (0 - 1) mod 3 = 2 in round 1) kept the real drawing, NOT a skipped
    // one. Note it is NOT chain 0 — u0 never touches its own chain.
    expect(s.phase).toBe('GUESS')
    expect(assignedChainOrder(0, 1, N)).toBe(2)
    const kept = s.chains[2].steps[1]
    expect(kept).toBeDefined()
    expect(kept.skipped).toBeUndefined()
    expect(JSON.parse(kept.content)).toHaveLength(1)
    // The seats that never submitted are the ones that got the skipped placeholder.
    expect(s.chains.some((c) => c.steps[1]?.skipped)).toBe(true)
  })

  it('rejects a drawing that arrives a tick too late (after the phase advanced)', () => {
    const N = 3
    let { state: s, conns } = startedGame(N)
    s = step(
      s,
      conns,
      conns.map((c) => ({ userId: c.userId, action: 'SUBMIT_PROMPT', data: { text: c.name } })),
      2000,
    )
    expect(s.phase).toBe('DRAW')

    // Nobody draws → the timer fires, chains are synthesized as skipped, and the
    // round advances to GUESS.
    s = step(s, conns, [], s.phaseEndsAt! + 1)
    expect(s.phase).toBe('GUESS')
    expect(s.chains[0].steps[1].skipped).toBe(true)

    // A drawing that lands one tick late (phase already GUESS) is ignored by the
    // phase guard — the skipped placeholder stands, no corruption.
    s = step(
      s,
      conns,
      [{ userId: 'u0', action: 'SUBMIT_DRAWING', data: { strokes: '[{"color":"#000","width":6,"points":[0.1,0.1,0.5,0.5]}]' } }],
      s.phaseEndsAt! - 10,
    )
    expect(s.chains[0].steps[1].skipped).toBe(true)
  })
})

describe('drawing payload clamp (untrusted client input)', () => {
  it('caps stroke count and points-per-stroke, dropping the rest', () => {
    const N = 3
    let { state: s, conns } = startedGame(N)
    s = step(
      s,
      conns,
      conns.map((c) => ({ userId: c.userId, action: 'SUBMIT_PROMPT', data: { text: c.name } })),
      2000,
    )
    expect(s.phase).toBe('DRAW')

    // u0 (seat 0) draws chain 2 in round 1. Submit a hostile oversized payload
    // (well past both caps: 700 > MAX_STROKES 600, 900 > 2*MAX_POINTS 800).
    const hugeStroke = { color: '#000000', width: 8, points: Array(900).fill(0.5) }
    const hugePayload = JSON.stringify(Array(700).fill(hugeStroke))
    s = step(s, conns, [{ userId: 'u0', action: 'SUBMIT_DRAWING', data: { strokes: hugePayload } }], 3000)

    const stored = JSON.parse(s.chains[assignedChainOrder(0, 1, N)].steps[1].content)
    expect(Array.isArray(stored)).toBe(true)
    expect(stored.length).toBeLessThanOrEqual(600) // MAX_STROKES
    for (const st of stored) {
      expect(st.points.length).toBeLessThanOrEqual(800) // 2 * MAX_POINTS_PER_STROKE
      for (const n of st.points) expect(n).toBeGreaterThanOrEqual(0)
    }
  }, 20000)

  it('coerces a malformed payload to an empty drawing', () => {
    const N = 2
    let { state: s, conns } = startedGame(N)
    s = step(
      s,
      conns,
      conns.map((c) => ({ userId: c.userId, action: 'SUBMIT_PROMPT', data: { text: c.name } })),
      2000,
    )
    s = step(s, conns, [{ userId: 'u0', action: 'SUBMIT_DRAWING', data: { strokes: 'not json{{' } }], 3000)
    // N=2: seat 0 draws the OTHER player's chain (chain 1), never its own.
    expect(assignedChainOrder(0, 1, N)).toBe(1)
    expect(s.chains[1].steps[1].content).toBe('[]')
    expect(s.chains[0].steps[1]).toBeUndefined()
  })
})

describe('rejoin', () => {
  it('a player who reconnects with a new userId but same cid keeps their seat', () => {
    const N = 3
    let { state: s, conns } = startedGame(N)
    s = step(
      s,
      conns,
      conns.map((c) => ({ userId: c.userId, action: 'SUBMIT_PROMPT', data: { text: c.name } })),
      2000,
    )
    expect(s.phase).toBe('DRAW')

    // Player 1 reconnects as a fresh anon connection but re-sends the same cid.
    const rejoined: Conn = { userId: 'u1-new', cid: 'cid1', name: 'Player1' }
    const conns2 = [conns[0], rejoined, conns[2]]
    s = step(s, conns2, [setName(rejoined)], 2500)

    // Their seat (chain ownership) is unchanged: cid1 still owns chain order 1.
    const seat = s.chains.findIndex((c) => c.ownerCid === 'cid1')
    expect(seat).toBe(1)
    // And they can submit on their assigned chain this round.
    const chainOrder = assignedChainOrder(seat, s.round, s.seatCount)
    s = step(
      s,
      conns2,
      [{ userId: 'u1-new', action: 'SUBMIT_DRAWING', data: { strokes: '[]' } }],
      2600,
    )
    expect(s.chains[chainOrder].steps[s.round]?.authorCid).toBe('cid1')
  })
})

describe('chain rotation through a whole game (nobody ever gets their own chain)', () => {
  /**
   * The regression this file exists to pin: the owner reported "I write a prompt
   * and then I get the same prompt to draw." Play a full N-player game where
   * every submission is tagged with its author, then assert that no chain ever
   * carries a post-prompt step written by its own owner.
   */
  function playFullGame(N: number): GameState {
    let { state: s, conns } = startedGame(N)
    let now = 2000
    s = step(
      s,
      conns,
      conns.map((c) => ({ userId: c.userId, action: 'SUBMIT_PROMPT', data: { text: `${c.name}-seed` } })),
      now,
    )
    for (let round = 1; round <= totalRounds(N); round++) {
      now += 1000
      const action = s.phase === 'DRAW' ? 'SUBMIT_DRAWING' : 'SUBMIT_GUESS'
      const inputs = conns.map((c) =>
        action === 'SUBMIT_DRAWING'
          ? { userId: c.userId, action, data: { strokes: '[]' } }
          : { userId: c.userId, action, data: { text: `${c.name}-guess-r${round}` } },
      )
      s = step(s, conns, inputs, now)
    }
    return s
  }

  for (const N of [2, 3, 4, 5, 8]) {
    it(`${N}-player game: every chain is seeded by its owner and then only touched by others`, () => {
      const s = playFullGame(N)
      expect(s.phase).toBe('REVEAL')
      expect(s.chains).toHaveLength(N)

      for (const chain of s.chains) {
        // Seed prompt: the owner's own words.
        expect(chain.steps[0].type).toBe('prompt')
        expect(chain.steps[0].authorCid).toBe(chain.ownerCid)
        // Every later step belongs to a DIFFERENT seat, and each of the other
        // N-1 seats contributes exactly once.
        const authors = new Set<string>()
        for (let r = 1; r <= totalRounds(N); r++) {
          const stepAtR = chain.steps[r]
          expect(stepAtR, `chain ${chain.order} is missing round ${r}`).toBeDefined()
          expect(
            stepAtR.authorCid,
            `chain ${chain.order} was handed back to its owner in round ${r}`,
          ).not.toBe(chain.ownerCid)
          expect(authors.has(stepAtR.authorCid)).toBe(false)
          authors.add(stepAtR.authorCid)
        }
        expect(authors.size).toBe(N - 1)
        // A chain ends up exactly N steps long: prompt + one per other seat.
        expect(Object.keys(chain.steps)).toHaveLength(N)
      }
    })
  }

  it('4-player game alternates DRAW, GUESS, DRAW and stops (no 4th round)', () => {
    const N = 4
    let { state: s, conns } = startedGame(N)
    let now = 2000
    s = step(
      s,
      conns,
      conns.map((c) => ({ userId: c.userId, action: 'SUBMIT_PROMPT', data: { text: c.name } })),
      now,
    )
    const seen: Array<{ round: number; phase: string }> = []
    for (let round = 1; round <= totalRounds(N); round++) {
      seen.push({ round: s.round, phase: s.phase })
      now += 1000
      const action = s.phase === 'DRAW' ? 'SUBMIT_DRAWING' : 'SUBMIT_GUESS'
      const inputs = conns.map((c) =>
        action === 'SUBMIT_DRAWING'
          ? { userId: c.userId, action, data: { strokes: '[]' } }
          : { userId: c.userId, action, data: { text: `${c.name}-g` } },
      )
      s = step(s, conns, inputs, now)
    }
    expect(seen).toEqual([
      { round: 1, phase: 'DRAW' },
      { round: 2, phase: 'GUESS' },
      { round: 3, phase: 'DRAW' },
    ])
    expect(s.phase).toBe('REVEAL')
  })
})

describe('edge case: two seats', () => {
  it('plays exactly one DRAW round, never reaches GUESS, and reveals a 2-step chain', () => {
    const N = 2
    let { state: s, conns } = startedGame(N)
    expect(totalRounds(N)).toBe(1)

    s = step(
      s,
      conns,
      conns.map((c) => ({ userId: c.userId, action: 'SUBMIT_PROMPT', data: { text: `${c.name}-seed` } })),
      2000,
    )
    expect(s.phase).toBe('DRAW')
    expect(s.round).toBe(1)

    // Each player draws the OTHER player's prompt.
    s = step(
      s,
      conns,
      conns.map((c) => ({ userId: c.userId, action: 'SUBMIT_DRAWING', data: { strokes: '[]' } })),
      3000,
    )

    // One round only — straight to the slideshow, no GUESS phase.
    expect(s.phase).toBe('REVEAL')
    for (const chain of s.chains) {
      expect(Object.keys(chain.steps)).toHaveLength(2)
      expect(chain.steps[0].type).toBe('prompt')
      expect(chain.steps[1].type).toBe('drawing')
      expect(chain.steps[1].authorCid).not.toBe(chain.ownerCid)
      expect(chain.steps[2]).toBeUndefined()
    }
    // Player0 seeded chain 0 and drew chain 1; Player1 did the mirror image.
    expect(s.chains[0].steps[1].authorCid).toBe('cid1')
    expect(s.chains[1].steps[1].authorCid).toBe('cid0')

    // The slideshow walks 2 chains x 2 steps and then finishes.
    let now = 4000
    let guard = 0
    while (s.phase === 'REVEAL' && guard++ < 50) {
      now += 100
      s = step(s, conns, [{ userId: 'u0', action: 'REVEAL_NEXT', data: {} }], now)
    }
    expect(s.phase).toBe('DONE')
    expect(guard).toBe(4) // (2 chains x 2 steps) transitions, last one lands on DONE
  })
})

describe('edge case: a single seat', () => {
  /**
   * MIN_PLAYERS keeps a 1-player game out of the lobby, so this is defensive:
   * with nobody to pass to there are zero rounds, and the right behaviour is to
   * seed the chain and go straight to the recap — never to hand the prompt back.
   */
  function soloPromptState(): GameState {
    const s = createInitialState()
    s.phase = 'PROMPT'
    s.hostCid = 'solo'
    s.seatCount = 1
    s.round = 0
    s.chains = [{ order: 0, ownerCid: 'solo', ownerName: 'Solo', steps: {} }] as Chain[]
    s.players = {
      u0: {
        userId: 'u0', cid: 'solo', name: 'Solo', color: '#e8553b',
        isHost: true, connected: true, joinedAt: 1,
      },
    }
    s.phaseEndsAt = 5000
    return s
  }

  it('skips straight from PROMPT to the recap instead of replaying the prompt', () => {
    const conns: Conn[] = [{ userId: 'u0', cid: 'solo', name: 'Solo' }]
    let s = soloPromptState()
    expect(totalRounds(s.seatCount)).toBe(0)

    s = step(s, conns, [{ userId: 'u0', action: 'SUBMIT_PROMPT', data: { text: 'a lonely cactus' } }], 4000)

    expect(s.phase).toBe('REVEAL')
    expect(s.round).toBe(0)
    expect(s.chains[0].steps[0].content).toBe('a lonely cactus')
    expect(s.chains[0].steps[1]).toBeUndefined() // no round handed back to the author
  })

  it('reaches DONE from the recap without looping or crashing', () => {
    const conns: Conn[] = [{ userId: 'u0', cid: 'solo', name: 'Solo' }]
    let s = soloPromptState()
    s = step(s, conns, [], 6000) // timeout with no prompt: a seed is synthesized
    expect(s.phase).toBe('REVEAL')

    let now = 7000
    let guard = 0
    while (s.phase === 'REVEAL' && guard++ < 20) {
      now += 100
      s = step(s, conns, [{ userId: 'u0', action: 'REVEAL_NEXT', data: {} }], now)
    }
    expect(s.phase).toBe('DONE')
  })
})
