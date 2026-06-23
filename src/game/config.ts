/**
 * Doodle Chain — tunable game configuration. Single source for every timing,
 * limit, and palette constant. No magic numbers anywhere else in the engine.
 *
 * Pure module: no React, no SDK imports, safe to load in the worker DO and the
 * client alike.
 */

import type { GameConfig } from './types'

/** Seat limits for a single room. */
export const MIN_PLAYERS = 2
export const MAX_PLAYERS = 10

/** Display-name bounds. */
export const MAX_NAME_LENGTH = 18

/** Free-text bounds for a prompt or a guess. */
export const MAX_TEXT_LENGTH = 80

/**
 * Drawing payload guards — a stroke is a polyline; we cap total points and
 * stroke count so a single drawing can never blow the DO state budget or the
 * broadcast frame. The canvas simplifies client-side before submit; the engine
 * trusts but the worker clamps as a backstop.
 */
export const MAX_STROKES = 600
export const MAX_POINTS_PER_STROKE = 400

/** Default per-phase durations (ms). The host can shorten draw/guess in lobby. */
export const DEFAULT_CONFIG: GameConfig = {
  promptSeconds: 50,
  drawSeconds: 70,
  guessSeconds: 40,
  // Shared slideshow: ms each reveal step lingers before auto-advancing. The
  // host can also tap to advance early.
  revealStepMs: 4200,
}

/** Bounds the host can pick for draw/guess seconds in the lobby. */
export const DRAW_SECONDS_CHOICES = [40, 70, 120] as const
export const GUESS_SECONDS_CHOICES = [25, 40, 70] as const

/**
 * Player chip colors — a fixed, high-contrast set assigned in join order.
 * OKLCH-derived hexes tuned for the cream canvas (design bible: phase3).
 */
export const PLAYER_COLORS = [
  '#e8553b', // vermilion
  '#2d8a6d', // pine
  '#f2a93b', // marigold
  '#3b6fd4', // cobalt
  '#c0418f', // magenta
  '#7a52d6', // grape
  '#2aa3b8', // teal
  '#d98a2b', // amber
  '#5a8f2e', // moss
  '#d44a4a', // coral-red
] as const

/** Pick the next unused color, falling back to round-robin past the roster. */
export function nextColor(used: string[]): string {
  const free = PLAYER_COLORS.find((c) => !used.includes(c))
  return free ?? PLAYER_COLORS[used.length % PLAYER_COLORS.length]
}
