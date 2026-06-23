import { describe, expect, it } from 'vitest'
import { createInitialState, reduce, roster } from './engine'
import type { EngineInput, GameState, RosterEntry } from './types'
import { assignedChainOrder } from './rotation'

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

    // Rounds 1..N: each connected player submits on their assigned chain.
    for (let round = 1; round <= N; round++) {
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
    // Every chain has a full set of steps 0..N.
    for (const chain of s.chains) {
      for (let r = 0; r <= N; r++) expect(chain.steps[r]).toBeDefined()
      expect(chain.steps[0].skipped).toBeUndefined()
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

    // u0 (seat 0) draws chain 0 in round 1. Submit a hostile oversized payload
    // (well past both caps: 700 > MAX_STROKES 600, 900 > 2*MAX_POINTS 800).
    const hugeStroke = { color: '#000000', width: 8, points: Array(900).fill(0.5) }
    const hugePayload = JSON.stringify(Array(700).fill(hugeStroke))
    s = step(s, conns, [{ userId: 'u0', action: 'SUBMIT_DRAWING', data: { strokes: hugePayload } }], 3000)

    const stored = JSON.parse(s.chains[0].steps[1].content)
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
    expect(s.chains[0].steps[1].content).toBe('[]')
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
