import { useRef, useState } from 'react'
import type { UseDoodleChain } from '../useDoodleChain'
import { DrawingCanvas, BRUSH_WIDTHS, PALETTE, type DrawingCanvasHandle } from '../DrawingCanvas'
import { PhaseHeader, PhaseShell, WaitingForOthers } from './PhaseFrame'

export function DrawPhase({ game }: { game: UseDoodleChain }) {
  const { sourceStep, submitted, submitDrawing, submittedCount, totalSeats, seat } = game
  const canvasRef = useRef<DrawingCanvasHandle>(null)
  const [color, setColor] = useState<string>(PALETTE[0])
  const [width, setWidth] = useState<number>(BRUSH_WIDTHS[1])
  const [count, setCount] = useState(0)

  const header = (
    <PhaseHeader
      title="Draw it!"
      hint="draw what you read"
      phaseEndsAt={game.state.phaseEndsAt}
      serverNow={game.state.serverNow}
    />
  )

  if (seat < 0) return spectator(header)
  if (submitted) {
    return (
      <PhaseShell>
        {header}
        <WaitingForOthers done={submittedCount} total={totalSeats} />
      </PhaseShell>
    )
  }

  const prompt = sourceStep?.content ?? ''
  const send = () => submitDrawing(canvasRef.current?.getStrokesJson() ?? '[]')

  // Compact, viewport-fitting layout (tight padding + gaps) so the canvas,
  // toolbar, and "Done drawing" all fit one screen on a phone.
  return (
    <div className="mx-auto flex min-h-[100dvh] w-full max-w-3xl flex-col gap-2.5 px-4 py-3">
      {header}
      <div className="flex w-full flex-1 flex-col items-center gap-2.5">
        <div className="ink-panel tilt-l-sm flex items-center gap-3 px-5 py-2 sticker-stamp-sm">
          <span className="font-body text-xs font-bold uppercase tracking-widest text-muted-foreground">Draw this</span>
          <span className="font-hand text-2xl leading-tight" style={{ color: 'var(--game-ink)' }}>
            {prompt || '(no prompt)'}
          </span>
        </div>

        {/* Canvas is bounded by the available viewport height (minus the header,
            prompt, toolbar, and submit) so its square always leaves the toolbar
            and "Done drawing" on-screen, phones included. */}
        <div
          className="ink-panel mx-auto overflow-hidden p-0 sticker-stamp"
          style={{ width: 'min(100%, calc(100dvh - 24rem))', maxWidth: '34rem', aspectRatio: '1 / 1' }}
        >
          <DrawingCanvas
            ref={canvasRef}
            color={color}
            width={width}
            onChange={setCount}
            className="w-full"
          />
        </div>

        {/* Toolbar */}
        <div className="ink-panel flex w-full max-w-[34rem] flex-wrap items-center justify-between gap-3 p-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {PALETTE.map((c) => (
              <button
                key={c}
                onClick={() => {
                  setColor(c)
                  canvasRef.current?.setColor(c)
                }}
                aria-label={`color ${c}`}
                className="h-7 w-7 rounded-full border-[3px] transition-transform"
                style={{
                  background: c,
                  borderColor: color === c ? 'var(--game-primary)' : 'var(--game-ink)',
                  transform: color === c ? 'scale(1.18)' : 'none',
                }}
              />
            ))}
          </div>
          <div className="flex items-center gap-1.5">
            {BRUSH_WIDTHS.map((w) => (
              <button
                key={w}
                onClick={() => {
                  setWidth(w)
                  canvasRef.current?.setWidth(w)
                }}
                aria-label={`brush ${w}`}
                className="grid h-8 w-8 place-items-center rounded-full border-[3px]"
                style={{ borderColor: width === w ? 'var(--game-primary)' : 'var(--game-ink)' }}
              >
                <span className="block rounded-full bg-[var(--game-ink)]" style={{ width: Math.min(w, 18), height: Math.min(w, 18) }} />
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => canvasRef.current?.undo()}
              disabled={count === 0}
              className="btn-sticker bg-white px-3 py-1.5 font-display text-sm disabled:opacity-40"
            >
              Undo
            </button>
            <button
              onClick={() => canvasRef.current?.clear()}
              disabled={count === 0}
              className="btn-sticker bg-white px-3 py-1.5 font-display text-sm disabled:opacity-40"
            >
              Clear
            </button>
          </div>
        </div>

        <button
          data-testid="draw-done"
          onClick={send}
          className="btn-sticker px-10 py-3 font-display text-xl text-white"
          style={{ background: 'var(--game-primary)' }}
        >
          Done drawing
        </button>
      </div>
    </div>
  )
}

function spectator(header: React.ReactNode) {
  return (
    <PhaseShell>
      {header}
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
        <p className="font-display text-2xl font-extrabold">You joined mid-game</p>
        <p className="font-hand text-2xl text-muted-foreground">Hang tight, you are in for the next round.</p>
      </div>
    </PhaseShell>
  )
}
