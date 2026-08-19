import { useEffect, useRef } from 'react'

/**
 * Auto-submit the player's in-progress work a beat BEFORE the phase deadline, so
 * running out of time SAVES what's on the canvas / in the input box instead of
 * discarding it. Without this, a player who never taps "Done" has their chain
 * step filled by the server's `synthesizeMissing` with a skipped "(ran out of
 * time)" placeholder — losing real work they'd already made.
 *
 * Design notes:
 *  - `submit` is read through a ref so the LIVE closure (current strokes / text)
 *    is used at fire time, without rescheduling the timer on every keystroke.
 *  - It is the caller's job to no-op `submit` when there's nothing worth saving
 *    (empty canvas / blank text), so a genuinely idle seat still reads as
 *    skipped rather than submitting a blank.
 *  - Fires `LEAD_MS` before the server deadline so the SUBMIT lands in an
 *    equal-or-earlier tick than the server's timeout transition. `LEAD_MS` also
 *    has to swallow the client→server hop + clock-skew error, so it's generous
 *    (a whole second of the very end of a 40-70s phase is a fine price for never
 *    losing the work); the reducer applies buffered inputs before it synthesizes
 *    placeholders, so an in-tick submit still wins.
 *  - Mobile reality: a backgrounded or unloading tab can't run a timer, so we
 *    ALSO flush on `pagehide` and on `visibilitychange`, both gated to
 *    `HIDE_FLUSH_MS` before the deadline — that's the "drew, then got a
 *    notification" case. Away early (deadline far off) is left alone so a glance
 *    doesn't lock you in. iOS fires `pagehide` on plain backgrounding, not only
 *    on unload, so it needs the same window check as `visibilitychange`.
 *  - The clock offset is snapshotted in a ref when a fresh `serverNow` lands.
 *    Recomputing `serverNow - Date.now()` inside `remaining()` would cancel the
 *    `Date.now()` terms and pin it to a constant full-phase duration, which
 *    silently disables the visibility guard and makes `pagehide` fire always.
 *  - `firedForRef` keys the one-shot to `phaseEndsAt`, so a re-render from a
 *    fresh `serverNow` can't double-submit, and it re-arms on the next phase.
 */
const LEAD_MS = 1500
const HIDE_FLUSH_MS = 15_000

export function useAutoSubmitOnTimeout(
  phaseEndsAt: number | null,
  serverNow: number,
  submitted: boolean,
  submit: () => void,
): void {
  const submitRef = useRef(submit)
  submitRef.current = submit
  const firedForRef = useRef<number | null>(null)
  const offsetRef = useRef(0)

  // Snapshot the local<->server clock offset when a fresh serverNow lands, the
  // same way useCountdown does. It has to be captured ONCE rather than
  // recomputed per call: `serverNow - Date.now()` re-evaluated later cancels the
  // Date.now() terms and collapses remaining() to the constant
  // `phaseEndsAt - serverNow`, i.e. the whole phase duration, forever.
  useEffect(() => {
    if (serverNow > 0) offsetRef.current = serverNow - Date.now()
  }, [serverNow])

  useEffect(() => {
    if (phaseEndsAt === null || submitted) return

    const remaining = () => phaseEndsAt - (Date.now() + offsetRef.current)
    const fire = () => {
      if (firedForRef.current === phaseEndsAt) return // one submit per phase deadline
      firedForRef.current = phaseEndsAt
      submitRef.current()
    }

    // Primary path: a timer a beat before the deadline.
    const delay = remaining() - LEAD_MS
    let timer: ReturnType<typeof setTimeout> | undefined
    if (delay <= 0) fire()
    else timer = setTimeout(fire, delay)

    // Mobile fallback: the tab can't run the timer while hidden/unloading.
    const onVisibility = () => {
      if (document.visibilityState === 'hidden' && remaining() <= HIDE_FLUSH_MS) fire()
    }
    // pagehide is terminal on desktop but ALSO fires on iOS backgrounding, where
    // the page usually comes back. Gate it on the same near-deadline window as
    // visibilitychange so app-switching with a minute left doesn't lock the
    // player out of the rest of the phase.
    const onPageHide = () => {
      if (remaining() <= HIDE_FLUSH_MS) fire()
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', onPageHide)

    return () => {
      if (timer) clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', onPageHide)
    }
  }, [phaseEndsAt, serverNow, submitted])
}
