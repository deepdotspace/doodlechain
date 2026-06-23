/** Room code helpers — a short, unambiguous, shareable code IS the DO instance. */

// No O/0/I/1 to avoid misreads when someone reads a code aloud.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const CODE_LENGTH = 4

export function makeRoomCode(): string {
  let out = ''
  for (let i = 0; i < CODE_LENGTH; i++) {
    out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)]
  }
  return out
}

export function normalizeRoomCode(raw: string): string {
  return [...raw.toUpperCase()].filter((c) => ALPHABET.includes(c)).join('').slice(0, CODE_LENGTH)
}

export function isValidRoomCode(code: string): boolean {
  return code.length === CODE_LENGTH && [...code].every((c) => ALPHABET.includes(c))
}
