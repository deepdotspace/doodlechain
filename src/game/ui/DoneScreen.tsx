import { useNavigate } from 'react-router-dom'
import type { UseDoodleChain } from '../useDoodleChain'
import { Logo, Mascot } from './bits'

export function DoneScreen({ game }: { game: UseDoodleChain }) {
  const { isHost, begin } = game
  const navigate = useNavigate()

  return (
    <div className="mx-auto flex min-h-[100dvh] w-full max-w-xl flex-col items-center justify-center gap-6 px-4 py-10 text-center">
      <Logo className="text-2xl" />
      <Mascot size={120} mood="wow" />
      <h1 className="font-display text-4xl font-extrabold">That's a wrap!</h1>
      <p className="font-hand text-2xl text-muted-foreground">
        Every chain told its own ridiculous little story.
      </p>
      <div className="flex flex-col items-center gap-3">
        {isHost ? (
          <button
            onClick={begin}
            className="btn-sticker px-10 py-4 font-display text-xl text-white"
            style={{ background: 'var(--game-primary)' }}
          >
            Play again
          </button>
        ) : (
          <p className="font-hand text-xl text-muted-foreground">Waiting for the host to start a new round...</p>
        )}
        <button
          onClick={() => navigate('/')}
          className="btn-sticker bg-white px-8 py-2.5 font-display"
        >
          Leave room
        </button>
      </div>
    </div>
  )
}
