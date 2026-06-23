import { useEffect, useSyncExternalStore } from 'react'

/**
 * Background music — looping mp3 beds (Kevin MacLeod, CC BY 4.0; see CREDITS.md).
 * One shared <audio> element, swapped by game phase. Autoplay policy: .play()
 * rejects until the first user gesture, so we arm a one-shot pointer/key listener
 * that retries (the name/create/join tap starts it). One persisted mute toggle
 * silences it instantly.
 */

const TRACKS = {
  lobby: '/audio/lobby.mp3',
  game: '/audio/game.mp3',
  win: '/audio/win.mp3',
} as const
type Track = keyof typeof TRACKS

const VOLUME = 0.3
const STORAGE_KEY = 'dc-muted'

// ---- shared mute state ----
let muted = typeof window !== 'undefined' && window.localStorage.getItem(STORAGE_KEY) === '1'
const listeners = new Set<() => void>()

const isMuted = () => muted
function setMuted(next: boolean): void {
  muted = next
  try {
    window.localStorage.setItem(STORAGE_KEY, next ? '1' : '0')
  } catch {
    /* private mode — keep the in-memory toggle working */
  }
  syncMute()
  listeners.forEach((fn) => fn())
}
function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

// ---- audio singleton ----
let el: HTMLAudioElement | null = null
let currentSrc: string | null = null
let unlockArmed = false

function ensure(): HTMLAudioElement | null {
  if (typeof window === 'undefined') return null
  if (!el) {
    el = new Audio()
    el.loop = true
    el.volume = VOLUME
  }
  return el
}

function tryPlay(a: HTMLAudioElement): void {
  a.play().catch(() => armUnlock())
}

function armUnlock(): void {
  if (unlockArmed || typeof window === 'undefined') return
  unlockArmed = true
  const kick = () => {
    window.removeEventListener('pointerdown', kick)
    window.removeEventListener('keydown', kick)
    unlockArmed = false
    if (el && currentSrc && !muted) void el.play().catch(() => armUnlock())
  }
  window.addEventListener('pointerdown', kick)
  window.addEventListener('keydown', kick)
}

function setMusic(track: Track | null): void {
  const a = ensure()
  if (!a) return
  if (track === null) {
    a.pause()
    currentSrc = null
    return
  }
  const src = TRACKS[track]
  if (currentSrc !== src) {
    a.src = src
    currentSrc = src
  }
  a.volume = muted ? 0 : VOLUME
  if (!muted) tryPlay(a)
}

function syncMute(): void {
  const a = ensure()
  if (!a) return
  a.volume = muted ? 0 : VOLUME
  if (muted) a.pause()
  else if (currentSrc) tryPlay(a)
}

/** Map a game phase to one of the three beds. */
function trackForPhase(phase: string): Track {
  if (phase === 'REVEAL' || phase === 'DONE') return 'win'
  if (phase === 'LOBBY') return 'lobby'
  return 'game'
}

/** Drive the background bed from the current phase. Pass active=false to silence
 *  (e.g. while connecting). Music stops when the calling screen unmounts. */
export function useMusic(phase: string, active: boolean): void {
  useEffect(() => {
    setMusic(active ? trackForPhase(phase) : null)
  }, [phase, active])
  useEffect(() => () => setMusic(null), [])
}

/** Persistent mute/unmute button, fixed in the corner. */
export function MuteToggle() {
  const m = useSyncExternalStore(subscribe, isMuted, () => false)
  return (
    <button
      type="button"
      onClick={() => setMuted(!m)}
      aria-label={m ? 'Unmute music' : 'Mute music'}
      title={m ? 'Unmute music' : 'Mute music'}
      className="fixed bottom-3 right-3 z-50 grid place-items-center rounded-full"
      style={{
        height: 44,
        width: 44,
        background: '#fff',
        border: '3px solid var(--foreground, #1b1b1b)',
        boxShadow: '2px 2px 0 rgba(0,0,0,0.18)',
        fontSize: 18,
        cursor: 'pointer',
      }}
    >
      {m ? '🔇' : '🔊'}
    </button>
  )
}
