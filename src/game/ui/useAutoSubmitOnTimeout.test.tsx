// @vitest-environment jsdom
import { render, cleanup, act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAutoSubmitOnTimeout } from './useAutoSubmitOnTimeout'

function Harness(props: {
  phaseEndsAt: number | null
  serverNow: number
  submitted: boolean
  submit: () => void
}) {
  useAutoSubmitOnTimeout(props.phaseEndsAt, props.serverNow, props.submitted, props.submit)
  return null
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(0)
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('useAutoSubmitOnTimeout', () => {
  it('submits a beat before the deadline when not yet submitted', () => {
    const submit = vi.fn()
    render(<Harness phaseEndsAt={10_000} serverNow={0} submitted={false} submit={submit} />)
    // LEAD_MS = 1500 → fires at ~8500ms, comfortably before the 10s deadline.
    act(() => void vi.advanceTimersByTime(8_400))
    expect(submit).not.toHaveBeenCalled()
    act(() => void vi.advanceTimersByTime(300))
    expect(submit).toHaveBeenCalledTimes(1)
  })

  it('corrects for client/server clock skew when scheduling the submit', () => {
    const submit = vi.fn()
    // Client clock is 3s BEHIND the server (offset = serverNow − now = +3000).
    // Deadline 20_000 (server) → 17_000 (client). LEAD 1500 → fire at client 15_500,
    // i.e. 8_500ms after mounting at client-time 7_000. If the offset were ignored
    // the fire would be ~3s later, so this pins that the skew is applied.
    vi.setSystemTime(7_000)
    render(<Harness phaseEndsAt={20_000} serverNow={10_000} submitted={false} submit={submit} />)
    act(() => void vi.advanceTimersByTime(8_400))
    expect(submit).not.toHaveBeenCalled()
    act(() => void vi.advanceTimersByTime(300))
    expect(submit).toHaveBeenCalledTimes(1)
  })

  it('does nothing once already submitted', () => {
    const submit = vi.fn()
    render(<Harness phaseEndsAt={10_000} serverNow={0} submitted={true} submit={submit} />)
    act(() => void vi.advanceTimersByTime(20_000))
    expect(submit).not.toHaveBeenCalled()
  })

  it('does not fire after unmount (timer cleaned up)', () => {
    const submit = vi.fn()
    const { unmount } = render(
      <Harness phaseEndsAt={10_000} serverNow={0} submitted={false} submit={submit} />,
    )
    act(() => void vi.advanceTimersByTime(1_000))
    unmount()
    act(() => void vi.advanceTimersByTime(20_000))
    expect(submit).not.toHaveBeenCalled()
  })

  it('uses the LIVE submit closure at fire time, not the one from arm time', () => {
    const first = vi.fn()
    const second = vi.fn()
    const { rerender } = render(
      <Harness phaseEndsAt={10_000} serverNow={0} submitted={false} submit={first} />,
    )
    // Re-render with a new closure (same deadline → timer not rescheduled).
    rerender(<Harness phaseEndsAt={10_000} serverNow={0} submitted={false} submit={second} />)
    act(() => void vi.advanceTimersByTime(10_000))
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('fires immediately if mounted past the deadline (no negative-delay wait)', () => {
    const submit = vi.fn()
    vi.setSystemTime(9_999) // already inside the LEAD window before a 10s deadline
    render(<Harness phaseEndsAt={10_000} serverNow={9_999} submitted={false} submit={submit} />)
    expect(submit).toHaveBeenCalledTimes(1)
  })

  it('is a no-op with no deadline (lobby / reveal)', () => {
    const submit = vi.fn()
    render(<Harness phaseEndsAt={null} serverNow={0} submitted={false} submit={submit} />)
    act(() => void vi.advanceTimersByTime(60_000))
    expect(submit).not.toHaveBeenCalled()
  })
})
