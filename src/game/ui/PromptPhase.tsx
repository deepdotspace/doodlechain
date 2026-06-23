import { useState } from 'react'
import type { UseDoodleChain } from '../useDoodleChain'
import { MAX_TEXT_LENGTH } from '../config'
import { Mascot } from './bits'
import { PhaseBody, PhaseHeader, PhaseShell, WaitingForOthers } from './PhaseFrame'

const STARTERS = [
  'a cat riding a skateboard',
  'a wizard who lost his hat',
  'a robot baking cookies',
  'two dinosaurs sharing an umbrella',
  'a banana in a tiny hat',
]

export function PromptPhase({ game }: { game: UseDoodleChain }) {
  const { submitted, submitPrompt, submittedCount, totalSeats, seat } = game
  const [text, setText] = useState('')

  // A player who connects after the game has started has no seat this round.
  if (seat < 0) {
    return shell(
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
        <Mascot size={96} mood="think" />
        <p className="font-display text-2xl font-extrabold">You joined mid-game</p>
        <p className="font-hand text-2xl text-muted-foreground">Hang tight for the next round.</p>
      </div>,
      game,
    )
  }
  if (submitted) return shell(<WaitingForOthers done={submittedCount} total={totalSeats} />, game)

  const send = () => {
    const t = text.trim()
    if (t.length === 0) return
    submitPrompt(t)
  }

  return shell(
    <PhaseBody>
      <div className="flex flex-col items-center gap-2 text-center">
        <Mascot size={88} mood="happy" />
        <h2 className="font-display text-3xl font-extrabold">Write a prompt</h2>
        <p className="font-hand text-2xl text-muted-foreground">
          Something fun for the next player to draw. The weirder, the better.
        </p>
      </div>

      <div className="ink-panel tilt-r-sm w-full max-w-xl p-4 sticker-stamp">
        <textarea
          data-testid="prompt-input"
          autoFocus
          value={text}
          maxLength={MAX_TEXT_LENGTH}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              send()
            }
          }}
          placeholder="a penguin running for president..."
          className="h-24 w-full resize-none bg-transparent font-hand text-3xl leading-snug outline-none placeholder:text-black/25"
        />
        <div className="flex items-center justify-between">
          <button
            onClick={() => setText(STARTERS[Math.floor(Math.random() * STARTERS.length)])}
            className="font-display text-sm font-bold"
            style={{ color: 'var(--game-cobalt)' }}
          >
            shuffle an idea
          </button>
          <span className="font-body text-xs text-muted-foreground">
            {text.length}/{MAX_TEXT_LENGTH}
          </span>
        </div>
      </div>

      <button
        data-testid="prompt-send"
        onClick={send}
        disabled={text.trim().length === 0}
        className="btn-sticker px-10 py-3.5 font-display text-xl text-white disabled:opacity-50"
        style={{ background: 'var(--game-primary)' }}
      >
        Send it
      </button>
    </PhaseBody>,
    game,
  )
}

function shell(content: React.ReactNode, game: UseDoodleChain) {
  return (
    <PhaseShell>
      <PhaseHeader
        title="Write a prompt"
        hint="round 1 of the chain"
        phaseEndsAt={game.state.phaseEndsAt}
        serverNow={game.state.serverNow}
      />
      {content}
    </PhaseShell>
  )
}
