import type { ReactNode } from 'react'
import { Countdown, Logo, Mascot, SubmitProgress } from './bits'

/** The header every active phase shares: brand, round title, timer. */
export function PhaseHeader({
  title,
  hint,
  phaseEndsAt,
  serverNow,
}: {
  title: string
  hint: string
  phaseEndsAt: number | null
  serverNow: number
}) {
  return (
    <header className="flex w-full items-center justify-between gap-3">
      <div className="flex flex-col">
        <Logo className="text-xl" />
        <span className="font-hand text-lg leading-tight text-muted-foreground">{hint}</span>
      </div>
      <h1 className="hidden font-display text-2xl font-extrabold sm:block" style={{ color: 'var(--game-ink)' }}>
        {title}
      </h1>
      <Countdown phaseEndsAt={phaseEndsAt} serverNow={serverNow} />
    </header>
  )
}

/** Shown once the player has submitted: a calm "hang tight" with progress. */
export function WaitingForOthers({ done, total }: { done: number; total: number }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
      <Mascot size={96} mood="sleepy" />
      <p className="font-display text-2xl font-extrabold">Locked in!</p>
      <p className="font-hand text-2xl text-muted-foreground">
        Waiting on {Math.max(0, total - done)} more {total - done === 1 ? 'player' : 'players'}...
      </p>
      <SubmitProgress done={done} total={total} />
    </div>
  )
}

/** Standard centered content column for a phase. */
export function PhaseBody({ children }: { children: ReactNode }) {
  return <div className="flex w-full flex-1 flex-col items-center gap-5">{children}</div>
}

export function PhaseShell({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-[100dvh] w-full max-w-3xl flex-col gap-5 px-4 py-6">{children}</div>
  )
}
