import { useEffect, useRef } from 'react'
import type { UseDoodleChain } from '../useDoodleChain'
import type { ChainStep } from '../types'
import { StrokeRenderer } from '../StrokeRenderer'
import { Logo } from './bits'

export function RevealPhase({ game }: { game: UseDoodleChain }) {
  const { state, isHost, revealNext, revealBack } = game
  const chain = state.chains[state.revealChain]
  const scrollRef = useRef<HTMLDivElement>(null)

  // Keep the newest revealed link in view as the slideshow advances.
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [state.revealChain, state.revealStep])

  if (!chain) return null
  const totalChains = state.chains.length
  const steps: ChainStep[] = []
  for (let r = 0; r <= state.revealStep; r++) {
    const s = chain.steps[r]
    if (s) steps.push(s)
  }

  return (
    <div className="mx-auto flex min-h-[100dvh] w-full max-w-2xl flex-col gap-4 px-4 py-6">
      <header className="flex items-center justify-between">
        <Logo className="text-xl" />
        <span className="font-display text-sm font-extrabold uppercase tracking-wider text-muted-foreground">
          The reveal
        </span>
      </header>

      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-extrabold">
          {chain.ownerName}
          <span className="font-hand text-xl font-normal text-muted-foreground">'s chain</span>
        </h1>
        <span
          className="ink-panel px-3 py-1 font-display text-sm font-extrabold sticker-stamp-sm"
          style={{ color: 'var(--game-primary)' }}
        >
          {state.revealChain + 1} / {totalChains}
        </span>
      </div>

      <div ref={scrollRef} className="flex flex-1 flex-col gap-4 overflow-y-auto scrollbar-hide pb-4">
        {steps.map((step, i) => (
          <RevealStep key={`${state.revealChain}-${step.round}`} step={step} latest={i === steps.length - 1} />
        ))}
      </div>

      {isHost ? (
        <div className="flex items-center justify-center gap-3">
          <button onClick={revealBack} className="btn-sticker bg-white px-5 py-2.5 font-display">
            Back
          </button>
          <button
            data-testid="reveal-next"
            onClick={revealNext}
            className="btn-sticker px-8 py-2.5 font-display text-lg text-white"
            style={{ background: 'var(--game-primary)' }}
          >
            Next
          </button>
        </div>
      ) : (
        <p className="text-center font-hand text-xl text-muted-foreground">The host is presenting...</p>
      )}
    </div>
  )
}

function RevealStep({ step, latest }: { step: ChainStep; latest: boolean }) {
  const label =
    step.type === 'prompt' ? 'started with' : step.type === 'drawing' ? 'drew' : 'guessed'
  return (
    <div className={latest ? 'animate-pop' : ''}>
      <div className="mb-1 flex items-center gap-2">
        <span className="font-display text-sm font-extrabold">{step.authorName}</span>
        <span className="font-hand text-lg text-muted-foreground">{label}</span>
        {step.skipped && (
          <span className="font-body text-xs font-bold uppercase text-muted-foreground">(ran out of time)</span>
        )}
      </div>
      {step.type === 'drawing' ? (
        <div className="ink-panel tilt-r-sm overflow-hidden sticker-stamp" style={{ aspectRatio: '1 / 1', maxWidth: 380 }}>
          <StrokeRenderer strokes={step.content} className="h-full w-full" />
        </div>
      ) : (
        <div
          className="ink-panel tilt-l-sm inline-block px-5 py-3 font-hand text-3xl sticker-stamp-sm"
          style={{ color: step.type === 'prompt' ? 'var(--game-primary)' : 'var(--game-ink)' }}
        >
          {step.content || '(blank)'}
        </div>
      )}
    </div>
  )
}
