import { useState } from 'react'
import type { UseDoodleChain } from '../useDoodleChain'
import { MAX_TEXT_LENGTH } from '../config'
import { StrokeRenderer } from '../StrokeRenderer'
import { PhaseBody, PhaseHeader, PhaseShell, WaitingForOthers } from './PhaseFrame'

export function GuessPhase({ game }: { game: UseDoodleChain }) {
  const { sourceStep, submitted, submitGuess, submittedCount, totalSeats, seat } = game
  const [text, setText] = useState('')

  const header = (
    <PhaseHeader
      title="What is it?"
      hint="caption the drawing"
      phaseEndsAt={game.state.phaseEndsAt}
      serverNow={game.state.serverNow}
    />
  )

  if (seat < 0) {
    return (
      <PhaseShell>
        {header}
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
          <p className="font-display text-2xl font-extrabold">You joined mid-game</p>
          <p className="font-hand text-2xl text-muted-foreground">Hang tight for the next round.</p>
        </div>
      </PhaseShell>
    )
  }
  if (submitted) {
    return (
      <PhaseShell>
        {header}
        <WaitingForOthers done={submittedCount} total={totalSeats} />
      </PhaseShell>
    )
  }

  const send = () => {
    const t = text.trim()
    if (t.length === 0) return
    submitGuess(t)
  }

  return (
    <PhaseShell>
      {header}
      <PhaseBody>
        <h2 className="font-display text-2xl font-extrabold">What did they draw?</h2>
        <div className="ink-panel w-full max-w-md overflow-hidden sticker-stamp" style={{ aspectRatio: '1 / 1' }}>
          <StrokeRenderer strokes={sourceStep?.content} className="h-full w-full" />
        </div>
        <div className="ink-panel tilt-r-sm flex w-full max-w-md items-center gap-2 p-3">
          <input
            data-testid="guess-input"
            autoFocus
            value={text}
            maxLength={MAX_TEXT_LENGTH}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && send()}
            placeholder="my best guess is..."
            className="w-full bg-transparent font-hand text-2xl outline-none placeholder:text-black/25"
          />
        </div>
        <button
          data-testid="guess-send"
          onClick={send}
          disabled={text.trim().length === 0}
          className="btn-sticker px-10 py-3.5 font-display text-xl text-white disabled:opacity-50"
          style={{ background: 'var(--game-primary)' }}
        >
          Lock in guess
        </button>
      </PhaseBody>
    </PhaseShell>
  )
}
