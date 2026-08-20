/**
 * Chain rotation — the seat math that makes Doodle Chain a "drawing telephone".
 * Pure integer seat arithmetic, so it runs identically in the worker DO and the
 * client with no record plumbing.
 *
 * Rules (N seated players, seats 0..N-1; chain C is owned by seat C):
 *   - Round 0 is the seed PROMPT, authored by the chain's owner (seat C).
 *     After that the owner NEVER touches chain C again — that is the whole
 *     point of telephone: you must not see what became of your own prompt
 *     until the reveal.
 *   - The stack passes one seat forward per round: in round R chain C is held
 *     by seat ((C + R) mod N). Equivalently, seat P works on chain
 *     ((P - R) mod N) that round.
 *   - Play runs for rounds 1..N-1 (`totalRounds`), which is exactly the number
 *     of seats that are NOT the owner. Over those rounds every chain is held by
 *     every other seat exactly once, every seat touches every chain but its own
 *     exactly once, and no two seats ever share a chain in the same round.
 *   - Odd round => DRAW, even round => GUESS. A chain therefore ends up with N
 *     steps: the prompt plus one contribution from each of the other N-1 seats.
 */

/** Round 0 is the prompt; odd rounds draw, even rounds guess. */
export function isDrawingRound(round: number): boolean {
  return round % 2 === 1
}

export function phaseForRound(round: number): 'DRAW' | 'GUESS' {
  return isDrawingRound(round) ? 'DRAW' : 'GUESS'
}

/**
 * How many draw/guess rounds a game of `n` seats plays after the seed prompt.
 * One round per seat that is not the chain's owner, so nobody is ever handed
 * their own chain. N=2 plays a single DRAW round; N=1 plays none at all.
 */
export function totalRounds(n: number): number {
  return Math.max(0, n - 1)
}

/** Positive modulo. */
function mod(a: number, n: number): number {
  return ((a % n) + n) % n
}

/**
 * Which chain order should the player at `seat` work on during `round`?
 * (seat - round) mod N. For round 1..N-1 this is never `seat` itself, so a
 * player never receives their own prompt back.
 */
export function assignedChainOrder(seat: number, round: number, n: number): number {
  if (n <= 0) return 0
  return mod(seat - round, n)
}

/**
 * Inverse: which seat holds chain `chainOrder` during `round`?
 * (chainOrder + round) mod N. Used to attribute a skipped/synthesized step to
 * the player who was actually responsible for it.
 */
export function holderSeatForChain(chainOrder: number, round: number, n: number): number {
  if (n <= 0) return 0
  return mod(chainOrder + round, n)
}
