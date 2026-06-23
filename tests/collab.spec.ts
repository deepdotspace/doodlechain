/**
 * Anonymous two-context join flow — one player creates a room, a second joins
 * by code, and BOTH connect to the same GameRoom (the room shell renders past
 * the "connecting" state).
 *
 * Scope note: this in-suite spec runs against the LOCAL vite+miniflare worker,
 * where Durable Object alarms (which drive the GameRoom tick loop, and thus the
 * cross-client roster broadcast) do not fire the way they do on the edge. So we
 * assert the join + connect flow here; the full multi-player roster sync, chain
 * rotation, server-authoritative timers, and slideshow are verified against the
 * real deploy by tests/mp-verify.mjs (run live, 4 concurrent players, 3x clean).
 */
import { test, expect } from '@playwright/test'

test('two anonymous players join the same room and connect', async ({ browser }) => {
  const ca = await browser.newContext()
  const cb = await browser.newContext()
  const a = await ca.newPage()
  const b = await cb.newPage()

  await a.goto('/')
  await a.waitForSelector('[data-testid="app-root"]', { timeout: 15000 })
  await a.getByTestId('name-input').fill('Ann')
  await a.getByTestId('create-room').click()
  await a.waitForURL(/\/room\/[A-Z0-9]{4}/, { timeout: 20000 })
  const code = a.url().split('/room/')[1]
  expect(code).toMatch(/^[A-Z0-9]{4}$/)

  await b.goto(`/room/${code}`)
  await b.getByTestId('nickname-input').waitFor({ timeout: 15000 })
  await b.getByTestId('nickname-input').fill('Bo')
  await b.getByTestId('nickname-submit').click()

  // Both connect to the room: the phase wrapper appears only once the GameRoom
  // WebSocket is connected (RoomInner shows "Connecting..." until then).
  await expect(a.locator('[data-game-phase]')).toHaveCount(1, { timeout: 25000 })
  await expect(b.locator('[data-game-phase]')).toHaveCount(1, { timeout: 25000 })

  await ca.close()
  await cb.close()
})
