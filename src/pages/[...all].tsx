import { useNavigate } from 'react-router-dom'
import { Logo, Mascot } from '../game/ui/bits'

export default function NotFound() {
  const navigate = useNavigate()
  return (
    <div className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
      <Mascot size={100} mood="think" />
      <Logo className="text-3xl" />
      <p className="font-display text-2xl font-extrabold">This page wandered off the page.</p>
      <button
        onClick={() => navigate('/')}
        className="btn-sticker px-8 py-3 font-display text-lg text-white"
        style={{ background: 'var(--game-primary)' }}
      >
        Back home
      </button>
    </div>
  )
}
