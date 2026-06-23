/**
 * useDoodleChain — a typed wrapper over the SDK's useGameRoom for one room.
 *
 * Identity: anonymous clients can't see their server-stamped userId, so we mint
 * a stable per-device `cid` (localStorage) and send it with SET_NAME on every
 * connect. "me" is the player in the broadcast whose cid matches ours — works
 * for anonymous and signed-in players alike, and survives a reconnect (which
 * mints a fresh anon userId but reuses the cid → same seat).
 *
 * Host: there is no separate "stage" — the host is a normal player who also
 * draws and guesses, and additionally holds lobby/skip/reveal controls. If the
 * host seat is ever vacant, the earliest-joined connected player auto-claims it
 * so the lobby and slideshow never go dead. Phase advancement itself is
 * server-authoritative (the DO tick loop), so a missing host never freezes play.
 */

import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useGameRoom } from 'deepspace'
import { createInitialState } from './engine'
import { assignedChainOrder } from './rotation'
import { STATE_VERSION } from './types'
import type { Chain, ChainStep, GameState, PlayerState } from './types'

const CID_KEY = 'doodlechain.cid'
const NAME_KEY = 'doodlechain.name'

function readCid(): string {
  if (typeof window === 'undefined') return ''
  let c = window.localStorage.getItem(CID_KEY)
  if (!c) {
    c = `c-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`
    window.localStorage.setItem(CID_KEY, c)
  }
  return c
}

export function readStoredName(): string {
  if (typeof window === 'undefined') return ''
  return window.localStorage.getItem(NAME_KEY) ?? ''
}

export function storeName(name: string): void {
  if (typeof window !== 'undefined') window.localStorage.setItem(NAME_KEY, name)
}

function coerceState(raw: Record<string, unknown>): GameState {
  if (raw && typeof raw === 'object' && (raw as Partial<GameState>).v === STATE_VERSION) {
    return raw as unknown as GameState
  }
  return createInitialState()
}

export interface UseDoodleChain {
  /** Authoritative server state (coerced to a stable LOBBY default before sync). */
  state: GameState
  connected: boolean
  cid: string
  /** Me, resolved by cid (null until SET_NAME lands or while spectating). */
  me: PlayerState | null
  isHost: boolean
  /** Connected players in join order (includes me + host + bots). */
  players: PlayerState[]
  /** My seat index (chain order) once the game starts, or -1 (lobby/spectator). */
  seat: number
  /** The chain I'm assigned to act on this round, or null. */
  myChain: Chain | null
  /** The step I should look at (prior round on my chain), or null in PROMPT. */
  sourceStep: ChainStep | null
  /** Have I already submitted my step for the current round? */
  submitted: boolean
  /** How many seats have submitted this round, and the total. */
  submittedCount: number
  totalSeats: number
  // --- actions (no-op when not connected / not permitted server-side) ---
  setName: (name: string) => void
  begin: () => void
  skip: () => void
  setConfig: (drawSeconds: number, guessSeconds: number) => void
  addBots: (count: number) => void
  removeBot: (botId: string) => void
  submitPrompt: (text: string) => void
  submitDrawing: (strokesJson: string) => void
  submitGuess: (text: string) => void
  revealNext: () => void
  revealBack: () => void
}

export function useDoodleChain(roomId: string, name: string): UseDoodleChain {
  const cid = useMemo(() => readCid(), [])
  const { state, players: rawPlayers, connected, sendInput, startGame } = useGameRoom(roomId)
  const gs = useMemo(() => coerceState(state), [state])

  // Power on the DO tick loop as soon as we connect. The loop is what makes
  // phase advancement server-authoritative; it must run continuously while
  // anyone is in the room (not just during an active game), so the lobby
  // roster syncs and timers fire regardless of any single tab. startGame is
  // idempotent server-side (no-op if already running) and re-arms the loop if
  // a previous emptying of the room stopped it.
  const started = useRef(false)
  useEffect(() => {
    if (!connected) {
      started.current = false
      return
    }
    if (started.current) return
    started.current = true
    startGame()
  }, [connected, startGame])

  // (Re)send our name+cid whenever we (re)connect or the name changes.
  const lastSent = useRef<string>('')
  useEffect(() => {
    if (!connected || !name) return
    const sig = `${name}::${cid}`
    if (lastSent.current === sig) return
    lastSent.current = sig
    sendInput('SET_NAME', { name, cid })
  }, [connected, name, cid, sendInput, rawPlayers.length])

  const me = useMemo(
    () => Object.values(gs.players).find((p) => p.cid === cid && cid !== '') ?? null,
    [gs.players, cid],
  )
  const isHost = !!me && me.cid === gs.hostCid

  const players = useMemo(
    () =>
      Object.values(gs.players)
        .filter((p) => p.connected)
        .sort((a, b) => a.joinedAt - b.joinedAt || a.userId.localeCompare(b.userId)),
    [gs.players],
  )

  // Auto-claim a vacant host seat (earliest-joined connected named player) so the
  // lobby / slideshow controls always have an owner.
  useEffect(() => {
    if (!connected || !me) return
    const host = Object.values(gs.players).find((p) => p.cid === gs.hostCid)
    const vacant = !gs.hostCid || !host?.connected
    if (!vacant) return
    const earliest = players.find((p) => p.cid !== '')
    if (earliest && earliest.cid === me.cid) sendInput('CLAIM_HOST', {})
  }, [connected, me, gs.hostCid, gs.players, players, sendInput])

  const seat = useMemo(
    () => (me ? gs.chains.findIndex((c) => c.ownerCid === me.cid) : -1),
    [me, gs.chains],
  )

  const { myChain, sourceStep } = useMemo(() => {
    if (seat < 0 || gs.seatCount === 0 || (gs.phase !== 'PROMPT' && gs.phase !== 'DRAW' && gs.phase !== 'GUESS')) {
      return { myChain: null, sourceStep: null }
    }
    const order = gs.phase === 'PROMPT' ? seat : assignedChainOrder(seat, gs.round, gs.seatCount)
    const chain = gs.chains[order] ?? null
    const prev = chain && gs.round > 0 ? chain.steps[gs.round - 1] ?? null : null
    return { myChain: chain, sourceStep: prev }
  }, [seat, gs.phase, gs.round, gs.seatCount, gs.chains])

  const submitted = !!myChain && myChain.steps[gs.round] !== undefined
  const submittedCount = useMemo(
    () => gs.chains.filter((c) => c.steps[gs.round] !== undefined).length,
    [gs.chains, gs.round],
  )

  const setName = useCallback((n: string) => sendInput('SET_NAME', { name: n, cid }), [sendInput, cid])
  const begin = useCallback(() => sendInput('BEGIN', {}), [sendInput])
  const skip = useCallback(() => sendInput('SKIP', {}), [sendInput])
  const setConfig = useCallback(
    (drawSeconds: number, guessSeconds: number) => sendInput('SET_CONFIG', { drawSeconds, guessSeconds }),
    [sendInput],
  )
  const addBots = useCallback((count: number) => sendInput('ADD_BOTS', { count }), [sendInput])
  const removeBot = useCallback((botId: string) => sendInput('REMOVE_BOT', { botId }), [sendInput])
  const submitPrompt = useCallback((text: string) => sendInput('SUBMIT_PROMPT', { text }), [sendInput])
  const submitDrawing = useCallback((strokesJson: string) => sendInput('SUBMIT_DRAWING', { strokes: strokesJson }), [sendInput])
  const submitGuess = useCallback((text: string) => sendInput('SUBMIT_GUESS', { text }), [sendInput])
  const revealNext = useCallback(() => sendInput('REVEAL_NEXT', {}), [sendInput])
  const revealBack = useCallback(() => sendInput('REVEAL_BACK', {}), [sendInput])

  return {
    state: gs,
    connected,
    cid,
    me,
    isHost,
    players,
    seat,
    myChain,
    sourceStep,
    submitted,
    submittedCount,
    totalSeats: gs.seatCount,
    setName,
    begin,
    skip,
    setConfig,
    addBots,
    removeBot,
    submitPrompt,
    submitDrawing,
    submitGuess,
    revealNext,
    revealBack,
  }
}
