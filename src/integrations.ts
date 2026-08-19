/**
 * Integration billing config. Doodle Chain calls no external APIs — bots draw
 * from a bundled human-doodle pack (see src/game/doodles.ts), not an LLM — so
 * there's nothing to bill. Left as an empty map; anything added later defaults
 * to `developer` (owner-billed) unless flipped to `user`.
 */

export const integrations: Record<string, { billing: 'developer' | 'user' }> = {}
