/**
 * VENDORED FROM THE DEEPSPACE SDK — do not expect upstream updates.
 * =================================================================
 *
 * Source: `deepspace` v0.9.2, `src/client/hooks/game/useGameRoom.ts`.
 * Reason: SDK v0.17.0 deleted `useGameRoom`, the `GamePlayer` /
 *   `UseGameRoomResult` types, the `clientBuild.game*` builders, and the eight
 *   `MSG.GAME_*` protocol constants, with no replacement. Apps that drive an
 *   authoritative tick loop have to own the client hook themselves from
 *   0.17.0 onward.
 *
 * Why this is cheap: the hook is a plain WebSocket + `useState` hook. Its
 *   only surviving SDK dependencies — `getAuthToken`, `dispatch`, `encode` —
 *   are all still exported from `deepspace`, and `dispatch` / `encode` are
 *   generic over `BaseMessage<string, unknown>`, so they take this module's
 *   own message union without any SDK-side support for the game arms.
 *
 * Vendoring deltas (the only edits to the 0.9.2 body):
 *   1. The eight `GAME_*` wire constants are declared locally as `GAME_MSG`
 *      (identical strings) and merged with the SDK's surviving `MSG` into a
 *      drop-in `MSG` this module re-exports.
 *   2. The server → client game arms were removed from the SDK's
 *      `ServerMessage` union in 0.17.0, so this module declares
 *      `GameServerFrame` (the seven game arms plus `auth`) and hands that to
 *      `dispatch` as its type parameter. Payload narrowing inside each
 *      handler is preserved exactly.
 *   3. `clientBuild.gameInput` / `.gamePlayerReady` / `.gameStart` /
 *      `.gameEnd` were deleted with the union. They are inlined below as
 *      `gameBuild` — four one-line object builders, verbatim payload shapes.
 *   4. `wsLog` was always SDK-internal (never exported) and is inlined
 *      verbatim, along with the `DEEPSPACE_DEBUG` gate it read from
 *      `client/debug.ts`.
 *
 * Nothing else changed. The wire strings, the socket URL (`/ws/game/:roomId`,
 * a route each app declares in its own `worker.ts` — the SDK never owned it),
 * the reconnect behaviour, and the returned result shape are identical to
 * 0.9.2, so existing servers and UIs keep working across the upgrade.
 */

/**
 * useGameRoom — Connect to a GameRoom Durable Object.
 *
 * Opens a WebSocket to /ws/game/:roomId for real-time game state.
 *
 * @example
 * const { state, sendInput, players, connected } = useGameRoom('my-game')
 *
 * Implementation note: this hook uses the typed wire protocol helpers
 * (`gameBuild` for sends, `dispatch` for receives). Hand-rolled
 * `switch (msg.type)` blocks and raw `JSON.stringify({ type: MSG.X, payload:
 * ... })` sends are a fast route to the "silent drop" bug class when a payload
 * shape drifts — prefer the typed helpers instead.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  getAuthToken,
  dispatch,
  encode,
  MSG as CORE_MSG,
  type BaseMessage,
} from 'deepspace'

// ============================================================================
// Vendored protocol constants (vendoring delta #1)
// ============================================================================

/**
 * The eight game wire constants, verbatim from the SDK's
 * `shared/protocol/constants.ts` before 0.17.0 removed them. The strings are
 * the on-wire contract — changing one breaks every already-deployed client
 * and the vendored `GameRoom` on the server.
 */
export const GAME_MSG = {
  GAME_STATE: 'game.state',
  GAME_INPUT: 'game.input',
  GAME_PLAYER_JOIN: 'game.player_join',
  GAME_PLAYER_LEAVE: 'game.player_leave',
  GAME_PLAYER_READY: 'game.player_ready',
  GAME_START: 'game.start',
  GAME_END: 'game.end',
  GAME_TICK: 'game.tick',
} as const

/**
 * Drop-in replacement for `deepspace`'s `MSG`: every constant the SDK still
 * ships, plus the game constants it dropped. Client code that used to
 * `import { MSG } from 'deepspace'` can import it from here instead and keep
 * using `MSG.GAME_TICK` alongside `MSG.ERROR`.
 */
export const MSG = { ...CORE_MSG, ...GAME_MSG } as const

/** Type of any message type constant known to this module. */
export type MsgType = (typeof MSG)[keyof typeof MSG]

// ============================================================================
// Vendored wire union (vendoring delta #2)
// ============================================================================

/**
 * The server → client frames this hook understands, restored from the SDK's
 * pre-0.17.0 `ServerMessage` union. Handed to `dispatch` as its type
 * parameter so each handler's `payload` still narrows automatically.
 */
export type GameServerFrame =
  | BaseMessage<typeof MSG.AUTH, { canWrite: boolean }>
  | BaseMessage<
      typeof MSG.GAME_STATE,
      { state: unknown; tick: number; players: unknown[]; running: boolean }
    >
  | BaseMessage<typeof MSG.GAME_TICK, { state: unknown; tick: number }>
  | BaseMessage<typeof MSG.GAME_START, { state: unknown; tick: number }>
  | BaseMessage<typeof MSG.GAME_END, { state: unknown; tick: number }>
  | BaseMessage<typeof MSG.GAME_PLAYER_JOIN, { player: unknown }>
  | BaseMessage<typeof MSG.GAME_PLAYER_LEAVE, { userId: string }>
  | BaseMessage<typeof MSG.GAME_PLAYER_READY, { userId: string }>

/** Matches when a payload is intentionally empty — `{}` on the wire. */
type EmptyPayload = Record<string, never>

/**
 * The four client → server game frames, restored from the SDK's pre-0.17.0
 * `ClientMessage` union.
 */
export type GameClientFrame =
  | BaseMessage<typeof MSG.GAME_INPUT, { action: string; data: Record<string, unknown> }>
  | BaseMessage<typeof MSG.GAME_PLAYER_READY, EmptyPayload>
  | BaseMessage<typeof MSG.GAME_START, EmptyPayload>
  | BaseMessage<typeof MSG.GAME_END, EmptyPayload>

const EMPTY: EmptyPayload = {}

/**
 * Replacement for the deleted `clientBuild.game*` builders (vendoring delta
 * #3). Payload shapes are verbatim from the SDK's `shared/protocol/
 * messages.ts` at 0.9.2.
 */
export const gameBuild = {
  gameInput: (action: string, data: Record<string, unknown> = {}) =>
    ({ type: MSG.GAME_INPUT, payload: { action, data } }) as const,
  gamePlayerReady: () => ({ type: MSG.GAME_PLAYER_READY, payload: EMPTY }) as const,
  gameStart: () => ({ type: MSG.GAME_START, payload: EMPTY }) as const,
  gameEnd: () => ({ type: MSG.GAME_END, payload: EMPTY }) as const,
}

// ============================================================================
// Vendored debug logger (vendoring delta #4)
// ============================================================================

/**
 * Debug gate, verbatim from the SDK's `client/debug.ts`. Silent by default;
 * opt in with `localStorage.DEEPSPACE_DEBUG = '1'` or
 * `globalThis.DEEPSPACE_DEBUG = true`. Read once at module load so the gate is
 * a cheap boolean check per call.
 */
const DEBUG: boolean = (() => {
  try {
    const g = globalThis as { DEEPSPACE_DEBUG?: unknown; localStorage?: Storage }
    if (g.DEEPSPACE_DEBUG === true || g.DEEPSPACE_DEBUG === '1') return true
    const ls = g.localStorage?.getItem('DEEPSPACE_DEBUG')
    return ls === '1' || ls === 'true'
  } catch {
    // localStorage can throw (e.g. sandboxed iframes) — treat as disabled.
    return false
  }
})()

let activeCount = 0

/**
 * Shared WebSocket connection logger with active connection count.
 * Silent unless DEEPSPACE_DEBUG is set.
 */
function wsLog(
  event: 'connecting' | 'connected' | 'disconnected' | 'closing',
  label: string,
): void {
  if (event === 'connected') activeCount++
  if (event === 'closing') activeCount--

  if (DEBUG) console.log(`[ds:ws] ${event} → ${label} (${activeCount} active)`)
}

// ============================================================================
// Types
// ============================================================================

export interface GamePlayer {
  userId: string
  userName: string
  ready: boolean
  connectedAt: string
  data: Record<string, unknown>
}

export interface UseGameRoomResult {
  /** Current game state */
  state: Record<string, unknown>
  /** Current tick number */
  tick: number
  /** Connected players */
  players: GamePlayer[]
  /** Whether the game is currently running */
  running: boolean
  /** Whether WebSocket is connected */
  connected: boolean
  /**
   * Whether this connection has write access. False for viewers /
   * unauthenticated spectators — they receive state broadcasts but the
   * send callbacks below no-op. UIs should disable input controls when
   * false so spectators see why their actions don't take effect.
   */
  canWrite: boolean
  /** Send a game input (no-op for spectators) */
  sendInput: (action: string, data?: Record<string, unknown>) => void
  /** Mark self as ready (no-op for spectators) */
  setReady: () => void
  /** Request game start (no-op for spectators) */
  startGame: () => void
  /** Request game end (no-op for spectators) */
  endGame: () => void
}

// ============================================================================
// useGameRoom
// ============================================================================

export function useGameRoom(roomId: string): UseGameRoomResult {
  const [gameState, setGameState] = useState<Record<string, unknown>>({})
  const [tick, setTick] = useState(0)
  const [players, setPlayers] = useState<GamePlayer[]>([])
  const [running, setRunning] = useState(false)
  const [connected, setConnected] = useState(false)
  // Default false: assume spectator until the server's AUTH frame
  // confirms otherwise. See GameRoom.onConnect.
  const [canWrite, setCanWrite] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)

  useEffect(() => {
    let ws: WebSocket | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let alive = true

    const connect = async () => {
      if (!alive) return

      const token = await getAuthToken()
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const baseUrl = `${protocol}//${window.location.host}`
      const url = new URL(`/ws/game/${encodeURIComponent(roomId)}`, baseUrl)
      if (token) url.searchParams.set('token', token)

      wsLog('connecting', `game:${roomId}`)
      ws = new WebSocket(url.toString())
      wsRef.current = ws

      ws.onopen = () => {
        wsLog('connected', `game:${roomId}`)
        setConnected(true)
      }

      ws.onmessage = (event: MessageEvent) => {
        dispatch<GameServerFrame>(event.data, {
          [MSG.AUTH]: (p) => {
            setCanWrite(p.canWrite)
          },
          [MSG.GAME_STATE]: (p) => {
            setGameState(p.state as Record<string, unknown>)
            setTick(p.tick)
            setPlayers(p.players as GamePlayer[])
            setRunning(p.running)
          },
          [MSG.GAME_TICK]: (p) => {
            setGameState(p.state as Record<string, unknown>)
            setTick(p.tick)
          },
          [MSG.GAME_PLAYER_JOIN]: (p) => {
            const player = p.player as GamePlayer
            setPlayers((prev) => [...prev.filter((x) => x.userId !== player.userId), player])
          },
          [MSG.GAME_PLAYER_LEAVE]: (p) => {
            setPlayers((prev) => prev.filter((x) => x.userId !== p.userId))
          },
          [MSG.GAME_PLAYER_READY]: (p) => {
            setPlayers((prev) =>
              prev.map((x) => (x.userId === p.userId ? { ...x, ready: true } : x)),
            )
          },
          [MSG.GAME_START]: (p) => {
            setRunning(true)
            setGameState(p.state as Record<string, unknown>)
            setTick(p.tick)
          },
          [MSG.GAME_END]: (p) => {
            setRunning(false)
            setGameState(p.state as Record<string, unknown>)
          },
        })
      }

      ws.onclose = () => {
        wsLog('disconnected', `game:${roomId}`)
        wsRef.current = null
        setConnected(false)
        // Reset to the safe default so a reconnect with a degraded role
        // doesn't leave input/control buttons enabled until the new AUTH
        // frame lands. See useCanvas onclose for the rationale.
        setCanWrite(false)
        if (alive) reconnectTimer = setTimeout(connect, 1000)
      }

      ws.onerror = () => ws?.close()
    }

    connect()

    return () => {
      wsLog('closing', `game:${roomId}`)
      alive = false
      if (reconnectTimer) clearTimeout(reconnectTimer)
      if (ws) {
        ws.onclose = null
        ws.onmessage = null
        ws.onerror = null
        ws.close()
      }
      wsRef.current = null
    }
  }, [roomId])

  // Local write-gate. The server enforces the same rule in
  // GameRoom.onMessage; this is the UX side so spectator clicks don't
  // even leave the browser.
  const send = useCallback(
    <M extends { type: string; payload: unknown }>(message: M) => {
      if (!canWrite) return
      const ws = wsRef.current
      if (!ws || ws.readyState !== WebSocket.OPEN) return
      ws.send(encode(message))
    },
    [canWrite],
  )

  const sendInput = useCallback(
    (action: string, data: Record<string, unknown> = {}) => send(gameBuild.gameInput(action, data)),
    [send],
  )

  const setReady = useCallback(() => send(gameBuild.gamePlayerReady()), [send])
  const startGame = useCallback(() => send(gameBuild.gameStart()), [send])
  const endGame = useCallback(() => send(gameBuild.gameEnd()), [send])

  return { state: gameState, tick, players, running, connected, canWrite, sendInput, setReady, startGame, endGame }
}
