/**
 * Chain rotation — the seat math that makes Doodle Chain a "drawing telephone".
 * Ported from the original prototype `src/lib/chains.ts` (whose invariant is
 * pinned by unit tests) and reduced to pure integer seat arithmetic so it runs
 * identically in the worker DO and the client, with no record plumbing.
 *
 * Rules (N seated players, seats 0..N-1; chain C is owned by seat C):
 *   - Round 0 is the seed PROMPT, authored by the chain's owner (seat C).
 *   - In round R (1..N) chain C is held by seat ((C + R - 1) mod N).
 *     Equivalently, seat P works on chain ((P - R + 1) mod N) that round.
 *   - R=1 => seat P works on chain P: the owner draws their own prompt, then the
 *     stack passes one seat forward each subsequent round.
 *   - Odd round => DRAW, even round => GUESS.
 *   - With N rounds (1..N) every chain visits every seat exactly once, and no
 *     two seats ever share a chain in the same round.
 */

/** Round 0 is the prompt; odd rounds draw, even rounds guess. */
export function isDrawingRound(round: number): boolean {
  return round % 2 === 1
}

export function phaseForRound(round: number): 'DRAW' | 'GUESS' {
  return isDrawingRound(round) ? 'DRAW' : 'GUESS'
}

/** Positive modulo. */
function mod(a: number, n: number): number {
  return ((a % n) + n) % n
}

/**
 * Which chain order should the player at `seat` work on during `round`?
 * (seat - round + 1) mod N. The owner (seat C) draws chain C in round 1.
 */
export function assignedChainOrder(seat: number, round: number, n: number): number {
  if (n <= 0) return 0
  return mod(seat - round + 1, n)
}

/**
 * Inverse: which seat holds chain `chainOrder` during `round`?
 * (chainOrder + round - 1) mod N. Used to attribute a skipped/synthesized step
 * to the player who was actually responsible for it.
 */
export function holderSeatForChain(chainOrder: number, round: number, n: number): number {
  if (n <= 0) return 0
  return mod(chainOrder + round - 1, n)
}
