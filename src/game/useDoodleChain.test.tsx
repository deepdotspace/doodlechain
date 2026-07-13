// @vitest-environment jsdom
/**
 * Regression tests for the connect → write-access handoff in useDoodleChain.
 *
 * The SDK's useGameRoom exposes two distinct signals with a real ordering gap:
 *   - `connected`  flips true on the WebSocket `onopen`.
 *   - `canWrite`   flips true only once the server's `AUTH` message arrives.
 * Every send (`sendInput`, `startGame`) is silently DROPPED while `canWrite` is
 * false. So a client that fires its join sends on `connected` alone can lose the
 * SET_NAME that seats the player — and never recover, because it thinks it
 * already sent. That produced the "joiner is stuck on 'You joined mid-game' and
 * never gets a turn" bug.
 *
 * The mock below models that SDK contract faithfully: `send` is a no-op until
 * `canWrite`, and the send callbacks change identity only when `canWrite` flips
 * (mirroring useCallback([send]) / send = useCallback([canWrite]) in the SDK).
 */
import * as React from 'react'
import { render, act, cleanup } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  controller: {
    connected: false,
    canWrite: false,
    state: {} as Record<string, unknown>,
    players: [] as unknown[],
    sent: [] as Array<{ action: string; data?: unknown }>,
  },
}))

vi.mock('deepspace', () => ({
  useGameRoom: () => {
    const { connected, canWrite, state, players } = h.controller
    // Identity changes only when canWrite flips — exactly like the SDK, where
    // send = useCallback(..., [canWrite]) and sendInput/startGame = useCallback(..., [send]).
    const sendInput = React.useCallback(
      (action: string, data: Record<string, unknown> = {}) => {
        if (!h.controller.canWrite) return // SDK drops sends until write access
        h.controller.sent.push({ action, data })
      },
      [canWrite],
    )
    const startGame = React.useCallback(() => {
      if (!h.controller.canWrite) return
      h.controller.sent.push({ action: '__START__' })
    }, [canWrite])
    return { state, players, connected, canWrite, sendInput, startGame }
  },
}))

// Import AFTER the mock is registered.
import { useDoodleChain } from './useDoodleChain'

function Harness({ name }: { name: string }) {
  useDoodleChain('ABCD', name)
  return null
}

function installLocalStorage() {
  const store = new Map<string, string>()
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      key: (i: number) => Array.from(store.keys())[i] ?? null,
      get length() {
        return store.size
      },
    },
  })
}

function reset() {
  h.controller.connected = false
  h.controller.canWrite = false
  h.controller.state = {}
  h.controller.players = []
  h.controller.sent = []
}

function rerender(r: ReturnType<typeof render>, name = 'Yuke') {
  act(() => {
    r.rerender(<Harness name={name} />)
  })
}

beforeEach(() => {
  installLocalStorage()
  reset()
})
afterEach(cleanup)

describe('useDoodleChain connect → write-access handoff', () => {
  it('sends SET_NAME once write access is granted, even when connected fires first', () => {
    const r = render(<Harness name="Yuke" />)

    // The race window: connected, but the server has not granted write access yet.
    act(() => {
      h.controller.connected = true
      h.controller.canWrite = false
    })
    rerender(r)
    expect(h.controller.sent.find((m) => m.action === 'SET_NAME')).toBeFalsy()

    // AUTH arrives — write access granted. The join send MUST now go out.
    act(() => {
      h.controller.canWrite = true
    })
    rerender(r)

    const setName = h.controller.sent.find((m) => m.action === 'SET_NAME')
    expect(setName, 'SET_NAME must be sent once canWrite is granted').toBeTruthy()
    expect((setName!.data as { name: string }).name).toBe('Yuke')
  })

  it('powers on the game loop (startGame) once write access is granted', () => {
    const r = render(<Harness name="Ada" />)
    act(() => {
      h.controller.connected = true
      h.controller.canWrite = false
    })
    rerender(r, 'Ada')
    expect(h.controller.sent.find((m) => m.action === '__START__')).toBeFalsy()

    act(() => {
      h.controller.canWrite = true
    })
    rerender(r, 'Ada')
    expect(h.controller.sent.find((m) => m.action === '__START__')).toBeTruthy()
  })

  it('re-sends SET_NAME after a reconnect (fresh anon id, same cid → same seat)', () => {
    const r = render(<Harness name="Yuke" />)
    act(() => {
      h.controller.connected = true
      h.controller.canWrite = true
    })
    rerender(r)
    expect(h.controller.sent.filter((m) => m.action === 'SET_NAME')).toHaveLength(1)

    // Drop, then reconnect: canWrite cycles false → true again.
    act(() => {
      h.controller.connected = false
      h.controller.canWrite = false
    })
    rerender(r)
    act(() => {
      h.controller.connected = true
      h.controller.canWrite = true
    })
    rerender(r)

    expect(
      h.controller.sent.filter((m) => m.action === 'SET_NAME').length,
      'SET_NAME must be re-sent on reconnect to reclaim the seat',
    ).toBeGreaterThanOrEqual(2)
  })
})
