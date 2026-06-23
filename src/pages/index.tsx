import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Logo, Mascot } from '../game/ui/bits'
import { isValidRoomCode, makeRoomCode, normalizeRoomCode } from '../game/code'
import { readStoredName, storeName } from '../game/useDoodleChain'
import { MAX_NAME_LENGTH } from '../game/config'
import { useMusic } from '../game/music'

export default function Home() {
  useMusic('LOBBY', true)
  const navigate = useNavigate()
  const [name, setName] = useState(readStoredName())
  const [code, setCode] = useState('')
  const [mode, setMode] = useState<'idle' | 'join'>('idle')

  const nameOk = name.trim().length > 0
  const go = (roomCode: string) => {
    storeName(name.trim())
    navigate(`/room/${roomCode}`)
  }
  const create = () => nameOk && go(makeRoomCode())
  const join = () => nameOk && isValidRoomCode(code) && go(code)

  return (
    <div className="mx-auto flex min-h-[100dvh] w-full max-w-xl flex-col items-center justify-center gap-7 px-4 py-10">
      <div className="flex flex-col items-center gap-2 text-center">
        <Mascot size={120} mood="happy" />
        <Logo className="text-5xl" />
        <p className="max-w-sm font-hand text-2xl text-muted-foreground">
          Write a prompt. Draw what you read. Guess the drawing. Watch the chain go gloriously wrong.
        </p>
      </div>

      <div className="ink-panel tilt-r-sm flex w-full max-w-md flex-col gap-4 p-5 sticker-stamp">
        <label className="flex flex-col gap-1.5">
          <span className="font-display text-sm font-extrabold uppercase tracking-wider text-muted-foreground">
            Your name
          </span>
          <input
            data-testid="name-input"
            value={name}
            maxLength={MAX_NAME_LENGTH}
            onChange={(e) => setName(e.target.value)}
            placeholder="doodler"
            className="ink-panel w-full px-4 py-3 font-display text-2xl font-extrabold outline-none focus:border-[var(--game-primary)]"
            style={{ borderWidth: 3 }}
          />
        </label>

        {mode === 'idle' ? (
          <div className="flex flex-col gap-3">
            <button
              data-testid="create-room"
              onClick={create}
              disabled={!nameOk}
              className="btn-sticker w-full px-6 py-3.5 font-display text-xl text-white disabled:opacity-50"
              style={{ background: 'var(--game-primary)' }}
            >
              Create a room
            </button>
            <button
              data-testid="join-toggle"
              onClick={() => setMode('join')}
              disabled={!nameOk}
              className="btn-sticker w-full bg-white px-6 py-3 font-display text-lg disabled:opacity-50"
            >
              Join with a code
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <input
              data-testid="code-input"
              autoFocus
              value={code}
              onChange={(e) => setCode(normalizeRoomCode(e.target.value))}
              onKeyDown={(e) => e.key === 'Enter' && join()}
              placeholder="CODE"
              className="ink-panel w-full px-4 py-3 text-center font-display text-3xl font-extrabold uppercase tracking-[0.3em] outline-none focus:border-[var(--game-primary)]"
              style={{ borderWidth: 3 }}
            />
            <button
              data-testid="join-room"
              onClick={join}
              disabled={!nameOk || !isValidRoomCode(code)}
              className="btn-sticker w-full px-6 py-3.5 font-display text-xl text-white disabled:opacity-50"
              style={{ background: 'var(--game-secondary)' }}
            >
              Join room
            </button>
            <button onClick={() => setMode('idle')} className="font-display text-sm font-bold text-muted-foreground">
              back
            </button>
          </div>
        )}
      </div>

      <ol className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 font-hand text-xl text-muted-foreground">
        <li>2 to 10 players</li>
        <li aria-hidden>·</li>
        <li>no sign-up</li>
        <li aria-hidden>·</li>
        <li>about 5 minutes</li>
      </ol>
    </div>
  )
}
