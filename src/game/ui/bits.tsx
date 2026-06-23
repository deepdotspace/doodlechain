/**
 * Shared Doodle Chain UI bits — the logo, the generic doodle mascot, the
 * server-synced countdown, and player chips. Small, presentational, reused
 * across every phase.
 */

import { useEffect, useRef, useState } from 'react'
import type { PlayerState } from '../types'

/** Wordmark — "Doodle" in the display face, "Chain" scrawled in the hand face. */
export function Logo({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-flex items-baseline gap-1.5 ${className}`}>
      <span className="font-display font-extrabold tracking-tight text-foreground">Doodle</span>
      <span className="font-hand text-[1.15em] leading-none" style={{ color: 'var(--game-primary)' }}>
        Chain
      </span>
    </span>
  )
}

/**
 * Mascot — a generic friendly pencil-creature drawn in SVG (no trademarked art).
 * Wobbles gently. `mood` nudges the eyes/mouth for different phases.
 */
export function Mascot({
  size = 96,
  mood = 'happy',
  className = '',
}: {
  size?: number
  mood?: 'happy' | 'think' | 'wow' | 'sleepy'
  className?: string
}) {
  const mouth =
    mood === 'wow'
      ? 'M 40 64 q 12 14 24 0'
      : mood === 'think'
        ? 'M 42 66 q 12 -6 22 0'
        : mood === 'sleepy'
          ? 'M 42 66 h 22'
          : 'M 40 62 q 12 12 24 0'
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 104 104"
      className={`animate-wobble ${className}`}
      role="img"
      aria-label="Doodle Chain mascot"
    >
      {/* pencil body */}
      <g transform="rotate(-8 52 52)">
        <rect x="30" y="6" width="44" height="70" rx="14" fill="var(--game-accent)" stroke="var(--game-ink)" strokeWidth="3.5" />
        <path d="M30 70 q22 22 44 0 v-2 q-22 16 -44 0 z" fill="#f4d8a8" stroke="var(--game-ink)" strokeWidth="3.5" />
        <path d="M40 90 q12 12 24 0 l-12 8 z" fill="var(--game-ink)" />
      </g>
      {/* face */}
      <circle cx="42" cy="46" r="4.2" fill="var(--game-ink)" />
      <circle cx="62" cy="46" r="4.2" fill="var(--game-ink)" />
      {mood !== 'sleepy' && <circle cx="43.4" cy="44.6" r="1.3" fill="#fff" />}
      <path d={mouth} fill="none" stroke="var(--game-ink)" strokeWidth="3" strokeLinecap="round" />
      {/* cheeks */}
      <circle cx="34" cy="56" r="4" fill="var(--game-primary)" opacity="0.35" />
      <circle cx="70" cy="56" r="4" fill="var(--game-primary)" opacity="0.35" />
    </svg>
  )
}

/**
 * Countdown — server-authoritative. Reads the phase deadline + the server clock
 * at last broadcast, corrects for client/server skew, and ticks down locally.
 */
export function useCountdown(phaseEndsAt: number | null, serverNow: number): number {
  const offsetRef = useRef(0)
  const [, force] = useState(0)

  // Recompute the local↔server clock offset whenever a fresh serverNow lands.
  useEffect(() => {
    if (serverNow > 0) offsetRef.current = serverNow - Date.now()
  }, [serverNow])

  useEffect(() => {
    if (phaseEndsAt === null) return
    const id = setInterval(() => force((n) => n + 1), 250)
    return () => clearInterval(id)
  }, [phaseEndsAt])

  if (phaseEndsAt === null) return 0
  const remainingMs = phaseEndsAt - (Date.now() + offsetRef.current)
  return Math.max(0, Math.ceil(remainingMs / 1000))
}

export function Countdown({
  phaseEndsAt,
  serverNow,
  className = '',
}: {
  phaseEndsAt: number | null
  serverNow: number
  className?: string
}) {
  const left = useCountdown(phaseEndsAt, serverNow)
  if (phaseEndsAt === null) return null
  const urgent = left <= 10
  return (
    <div
      className={`ink-panel inline-flex items-center gap-2 px-4 py-1.5 font-display text-2xl font-extrabold tabular-nums sticker-stamp-sm ${urgent ? 'pulse-glow' : ''} ${className}`}
      style={{ color: urgent ? 'var(--game-primary)' : 'var(--game-ink)' }}
      aria-live="off"
    >
      <ClockIcon />
      {left}s
    </div>
  )
}

function ClockIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  )
}

/** A single player pill with their color + name (+ optional submitted check). */
export function PlayerChip({
  player,
  submitted,
  isMe,
  isHost,
}: {
  player: PlayerState
  submitted?: boolean
  isMe?: boolean
  isHost?: boolean
}) {
  return (
    <div
      data-testid="player-chip"
      className="ink-panel inline-flex items-center gap-2 px-3 py-1.5 sticker-stamp-sm"
      style={{ borderColor: 'var(--game-ink)' }}
    >
      <span className="grid h-6 w-6 place-items-center rounded-full font-display text-xs font-extrabold text-white" style={{ background: player.color }}>
        {player.name.slice(0, 1).toUpperCase()}
      </span>
      <span className="max-w-[8rem] truncate font-display font-bold text-foreground">
        {player.name}
        {isMe && <span className="ml-1 font-hand text-base" style={{ color: 'var(--game-primary)' }}>you</span>}
      </span>
      {isHost && (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="var(--game-accent)" stroke="var(--game-ink)" strokeWidth="1.5" strokeLinejoin="round" aria-label="host">
          <path d="M3 8l4.5 3L12 5l4.5 6L21 8l-1.5 10h-15L3 8z" />
        </svg>
      )}
      {submitted ? (
        <span className="grid h-5 w-5 place-items-center rounded-full text-white" style={{ background: 'var(--game-secondary)' }}>
          <CheckIcon />
        </span>
      ) : submitted === false ? (
        <span className="h-5 w-5 rounded-full border-2 border-dashed" style={{ borderColor: 'color-mix(in srgb, var(--game-ink) 30%, transparent)' }} />
      ) : null}
    </div>
  )
}

function CheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 13l4 4L19 7" />
    </svg>
  )
}

/** Progress dots showing how many seats have submitted this round. */
export function SubmitProgress({ done, total }: { done: number; total: number }) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-1.5">
      {Array.from({ length: total }).map((_, i) => (
        <span
          key={i}
          className="h-3 w-3 rounded-full border-2"
          style={{
            borderColor: 'var(--game-ink)',
            background: i < done ? 'var(--game-secondary)' : 'transparent',
          }}
        />
      ))}
    </div>
  )
}
