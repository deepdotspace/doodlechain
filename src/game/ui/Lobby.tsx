import { useState } from 'react'
import type { UseDoodleChain } from '../useDoodleChain'
import { DRAW_SECONDS_CHOICES, GUESS_SECONDS_CHOICES, MAX_PLAYERS, MIN_PLAYERS } from '../config'
import { Logo, Mascot, PlayerChip } from './bits'

export function Lobby({ game, code }: { game: UseDoodleChain; code: string }) {
  const { players, isHost, me, begin, setConfig, addBots, removeBot, state } = game
  const [copied, setCopied] = useState(false)
  const canStart = players.filter((p) => p.cid !== '').length >= MIN_PLAYERS
  const bots = players.filter((p) => p.isBot)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1400)
    } catch {
      /* clipboard may be blocked; the code is shown plainly anyway */
    }
  }

  return (
    <div className="mx-auto flex min-h-[100dvh] w-full max-w-5xl flex-col items-center gap-6 px-4 py-8">
      <header className="flex w-full items-center justify-between">
        <Logo className="text-2xl" />
        <div className="font-hand text-xl text-muted-foreground">the lobby</div>
      </header>

      <div className="flex flex-col items-center gap-1">
        <Mascot size={84} mood="happy" />
        <p className="font-hand text-2xl" style={{ color: 'var(--game-ink)' }}>
          Share the code, gather your friends.
        </p>
      </div>

      {/* Room code card */}
      <button
        onClick={copy}
        className="ink-panel tilt-r-sm sticker-stamp flex items-center gap-4 px-7 py-4"
        title="Tap to copy"
      >
        <div className="text-left">
          <div className="font-body text-xs font-bold uppercase tracking-widest text-muted-foreground">Room code</div>
          <div className="font-display text-5xl font-extrabold tracking-[0.2em] text-foreground">{code}</div>
        </div>
        <span
          className="font-display text-sm font-extrabold"
          style={{ color: copied ? 'var(--game-secondary)' : 'var(--game-primary)' }}
        >
          {copied ? 'copied!' : 'copy'}
        </span>
      </button>

      {/* Players */}
      <div className="flex w-full flex-col items-center gap-3">
        <div className="font-display text-sm font-extrabold uppercase tracking-wider text-muted-foreground">
          Players ({players.length}/{MAX_PLAYERS})
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2.5">
          {players.map((p) => (
            <div key={p.userId} className="relative">
              <PlayerChip player={p} isMe={p.cid === me?.cid} isHost={p.cid === state.hostCid} />
              {isHost && p.isBot && (
                <button
                  onClick={() => removeBot(p.userId)}
                  className="absolute -right-2 -top-2 grid h-5 w-5 place-items-center rounded-full border-2 border-[var(--game-ink)] bg-white text-xs font-bold"
                  title="Remove bot"
                >
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Host controls */}
      {isHost ? (
        <div className="ink-panel flex w-full max-w-md flex-col gap-4 p-5">
          <div className="flex items-center justify-between gap-3">
            <span className="font-display font-extrabold">Draw time</span>
            <Segmented
              options={DRAW_SECONDS_CHOICES}
              value={state.config.drawSeconds}
              onChange={(v) => setConfig(v, state.config.guessSeconds)}
              suffix="s"
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="font-display font-extrabold">Guess time</span>
            <Segmented
              options={GUESS_SECONDS_CHOICES}
              value={state.config.guessSeconds}
              onChange={(v) => setConfig(state.config.drawSeconds, v)}
              suffix="s"
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="font-display font-extrabold">Add a bot</span>
            <button
              data-testid="add-bot"
              onClick={() => addBots(1)}
              disabled={players.length >= MAX_PLAYERS}
              className="btn-sticker bg-secondary px-4 py-1.5 font-display text-sm text-secondary-foreground disabled:opacity-50"
              style={{ background: 'var(--game-accent)' }}
            >
              + Bot {bots.length > 0 ? `(${bots.length})` : ''}
            </button>
          </div>
          <button
            data-testid="start-game"
            onClick={begin}
            disabled={!canStart}
            className="btn-sticker mt-1 w-full px-6 py-3.5 font-display text-xl text-white disabled:opacity-50"
            style={{ background: 'var(--game-primary)' }}
          >
            {canStart ? 'Start the game' : `Need ${MIN_PLAYERS}+ players`}
          </button>
          {!canStart && (
            <p className="text-center font-hand text-lg text-muted-foreground">
              Add a friend or two, or drop in a bot to fill the table.
            </p>
          )}
        </div>
      ) : (
        <div className="ink-panel tilt-l-sm flex max-w-md flex-col items-center gap-2 p-5 text-center">
          <p className="font-display text-lg font-extrabold">Waiting for the host to start...</p>
          <p className="font-hand text-xl text-muted-foreground">Stretch your drawing hand.</p>
        </div>
      )}
    </div>
  )
}

function Segmented({
  options,
  value,
  onChange,
  suffix = '',
}: {
  options: readonly number[]
  value: number
  onChange: (v: number) => void
  suffix?: string
}) {
  return (
    <div className="inline-flex overflow-hidden rounded-xl border-[3px] border-[var(--game-ink)]">
      {options.map((o, i) => (
        <button
          key={o}
          onClick={() => onChange(o)}
          className={`px-3 py-1.5 font-display text-sm font-extrabold ${i > 0 ? 'border-l-[3px] border-[var(--game-ink)]' : ''}`}
          style={{
            background: value === o ? 'var(--game-primary)' : 'transparent',
            color: value === o ? '#fff' : 'var(--game-ink)',
          }}
        >
          {o}
          {suffix}
        </button>
      ))}
    </div>
  )
}
