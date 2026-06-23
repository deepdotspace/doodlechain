import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useDoodleChain, readStoredName, storeName } from '../../game/useDoodleChain'
import { normalizeRoomCode, isValidRoomCode } from '../../game/code'
import { MAX_NAME_LENGTH } from '../../game/config'
import { Logo, Mascot } from '../../game/ui/bits'
import { Lobby } from '../../game/ui/Lobby'
import { PromptPhase } from '../../game/ui/PromptPhase'
import { DrawPhase } from '../../game/ui/DrawPhase'
import { GuessPhase } from '../../game/ui/GuessPhase'
import { RevealPhase } from '../../game/ui/RevealPhase'
import { DoneScreen } from '../../game/ui/DoneScreen'

export default function Room() {
  const params = useParams()
  const code = normalizeRoomCode(params.code ?? '')
  const [name, setName] = useState(readStoredName())

  if (!isValidRoomCode(code)) return <InvalidCode />
  if (!name.trim()) return <NicknameGate onSet={(n) => setName(n)} />
  return <RoomInner code={code} name={name.trim()} />
}

function RoomInner({ code, name }: { code: string; name: string }) {
  const game = useDoodleChain(code, name)

  if (!game.connected) {
    return (
      <Centered>
        <Mascot size={96} mood="think" />
        <p className="font-display text-xl font-extrabold">Connecting to room {code}...</p>
      </Centered>
    )
  }

  return (
    <div data-game-phase={game.state.phase} style={{ display: 'contents' }}>
      <PhaseSwitch game={game} code={code} />
    </div>
  )
}

function PhaseSwitch({ game, code }: { game: ReturnType<typeof useDoodleChain>; code: string }) {
  switch (game.state.phase) {
    case 'LOBBY':
      return <Lobby game={game} code={code} />
    case 'PROMPT':
      return <PromptPhase game={game} />
    case 'DRAW':
      return <DrawPhase game={game} />
    case 'GUESS':
      return <GuessPhase game={game} />
    case 'REVEAL':
      return <RevealPhase game={game} />
    case 'DONE':
      return <DoneScreen game={game} />
    default:
      return (
        <Centered>
          <p className="font-display text-xl font-extrabold">Loading...</p>
        </Centered>
      )
  }
}

function NicknameGate({ onSet }: { onSet: (name: string) => void }) {
  const [val, setVal] = useState('')
  const ok = val.trim().length > 0
  const submit = () => {
    if (!ok) return
    storeName(val.trim())
    onSet(val.trim())
  }
  return (
    <Centered>
      <Mascot size={100} mood="happy" />
      <Logo className="text-3xl" />
      <p className="font-hand text-2xl text-muted-foreground">Pick a name to join the table.</p>
      <div className="ink-panel tilt-r-sm flex w-full max-w-sm flex-col gap-3 p-5 sticker-stamp">
        <input
          data-testid="nickname-input"
          autoFocus
          value={val}
          maxLength={MAX_NAME_LENGTH}
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder="doodler"
          className="ink-panel w-full px-4 py-3 font-display text-2xl font-extrabold outline-none focus:border-[var(--game-primary)]"
          style={{ borderWidth: 3 }}
        />
        <button
          data-testid="nickname-submit"
          onClick={submit}
          disabled={!ok}
          className="btn-sticker px-6 py-3 font-display text-xl text-white disabled:opacity-50"
          style={{ background: 'var(--game-primary)' }}
        >
          Join
        </button>
      </div>
    </Centered>
  )
}

function InvalidCode() {
  const navigate = useNavigate()
  return (
    <Centered>
      <p className="font-display text-2xl font-extrabold">That room code looks off.</p>
      <button
        onClick={() => navigate('/')}
        className="btn-sticker px-8 py-3 font-display text-lg text-white"
        style={{ background: 'var(--game-primary)' }}
      >
        Back home
      </button>
    </Centered>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
      {children}
    </div>
  )
}
