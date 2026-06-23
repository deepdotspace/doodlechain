/**
 * Integration billing config. Doodle Chain calls no external integrations —
 * the optional AI bots use offline canned content, not an LLM — so this stays
 * empty. Integrations not listed here default to 'developer'-billed.
 */

export const integrations: Record<string, { billing: 'developer' | 'user' }> = {}
