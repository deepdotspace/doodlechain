/**
 * Integration billing config. The AI bots call `anthropic/chat-completion` from
 * the game DO to draw + write; those calls are owner-billed (there's no signed-in
 * caller to bill for an anonymous party game). `developer` is also the default
 * for anything unlisted, but we name it explicitly so the billing intent is
 * obvious to the next reader.
 */

export const integrations: Record<string, { billing: 'developer' | 'user' }> = {
  anthropic: { billing: 'developer' },
}
