/**
 * App shell — global providers + a full-bleed paper background.
 *
 * Doodle Chain is an immersive party game, so there is no persistent top nav;
 * each page owns its layout. The provider stack is the SDK's anonymous-friendly
 * realtime context (the GameRoom WebSocket rides on it), exactly as the scaffold
 * wires it — extended, not replaced.
 */

import { Suspense, type ReactNode } from 'react'
import { Outlet } from 'react-router-dom'
import { DeepSpaceAuthProvider, useAuth } from 'deepspace'
import { RecordProvider, RecordScope } from 'deepspace'
import { ToastProvider } from '../components/ui'
import { APP_NAME, SCOPE_ID } from '../constants'
import { schemas } from '../schemas'
import { MuteToggle } from '../game/music'

export default function App() {
  return (
    <ToastProvider>
      <DeepSpaceAuthProvider>
        <AuthBoot>
          {/* data-testid="app-root" is the canonical "app shell mounted" hook
              the smoke tests rely on. */}
          <div data-testid="app-root" className="paper-grain min-h-[100dvh] text-foreground">
            <Suspense fallback={<BootLoading />}>
              <Outlet />
            </Suspense>
            <MuteToggle />
          </div>
        </AuthBoot>
      </DeepSpaceAuthProvider>
    </ToastProvider>
  )
}

function BootLoading() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center font-hand text-2xl text-muted-foreground">
      Sharpening pencils...
    </div>
  )
}

/** Waits for auth to resolve, then mounts the realtime data layer. */
function AuthBoot({ children }: { children: ReactNode }) {
  const { isLoaded } = useAuth()
  if (!isLoaded) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center font-hand text-2xl text-muted-foreground">
        Sharpening pencils...
      </div>
    )
  }
  return (
    <RecordProvider allowAnonymous>
      <RecordScope roomId={SCOPE_ID} schemas={schemas} appId={APP_NAME}>
        {children}
      </RecordScope>
    </RecordProvider>
  )
}
