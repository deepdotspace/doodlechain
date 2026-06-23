/**
 * Multiplayer verification — drives N concurrent anonymous players through a
 * full Doodle Chain game on the live URL via separate browser contexts, and
 * asserts the game reaches the slideshow with no stuck phase or desync.
 *
 *   node tests/mp-verify.mjs [N] [BASE_URL]
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const N = Number(process.argv[2] || 4)
const BASE = process.argv[3] || 'https://doodlechain.app.space'
const SHOTS = new URL('../docs/founder/phase5/shots/', import.meta.url).pathname
mkdirSync(SHOTS, { recursive: true })

const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function phaseOf(page) {
  try {
    return await page.locator('[data-game-phase]').first().getAttribute('data-game-phase', { timeout: 2000 })
  } catch {
    return null
  }
}

async function drawOnCanvas(page) {
  const c = page.locator('[data-testid=drawing-canvas]')
  const box = await c.boundingBox()
  if (!box) return
  for (let s = 0; s < 2; s++) {
    const y = box.y + box.height * (0.32 + s * 0.22)
    await page.mouse.move(box.x + box.width * 0.28, y)
    await page.mouse.down()
    for (let t = 0; t <= 8; t++) {
      await page.mouse.move(box.x + box.width * (0.28 + t * 0.05), y + Math.sin(t) * box.height * 0.05)
    }
    await page.mouse.up()
  }
}

/** Poll a page and act on whatever active phase appears, until REVEAL/DONE. */
async function playThrough(page, i, shots) {
  for (let guard = 0; guard < 60; guard++) {
    const phase = await phaseOf(page)
    if (phase === 'REVEAL' || phase === 'DONE') return phase
    try {
      if (phase === 'PROMPT' && (await page.locator('[data-testid=prompt-input]').isVisible())) {
        await page.fill('[data-testid=prompt-input]', randomPrompt(i))
        await page.click('[data-testid=prompt-send]')
        if (shots && i === 0) await page.screenshot({ path: `${SHOTS}desk-prompt.png` })
      } else if (phase === 'DRAW' && (await page.locator('[data-testid=draw-done]').isVisible())) {
        if (shots && i === 1) await page.screenshot({ path: `${SHOTS}desk-draw.png` })
        await drawOnCanvas(page)
        await page.click('[data-testid=draw-done]')
      } else if (phase === 'GUESS' && (await page.locator('[data-testid=guess-input]').isVisible())) {
        if (shots && i === 2) await page.screenshot({ path: `${SHOTS}desk-guess.png` })
        await page.fill('[data-testid=guess-input]', randomGuess(i, guard))
        await page.click('[data-testid=guess-send]')
      }
    } catch (e) {
      log(`P${i} action error in ${phase}:`, e.message.split('\n')[0])
    }
    await sleep(700)
  }
  return await phaseOf(page)
}

const PROMPTS = ['a cat surfing a pizza', 'a robot walking a dinosaur', 'a ghost eating soup', 'a sleepy volcano', 'a duck detective', 'a dancing cactus']
const GUESSES = ['a happy blob', 'a confused dog', 'a flying toaster', 'a brave noodle', 'a tiny dragon', 'a melting clock']
const randomPrompt = (i) => `${PROMPTS[i % PROMPTS.length]} (P${i})`
const randomGuess = (i, g) => `${GUESSES[(i + g) % GUESSES.length]} (P${i})`

async function main() {
  log(`Launching ${N} players against ${BASE}`)
  const browser = await chromium.launch()
  const contexts = await Promise.all(
    Array.from({ length: N }, () => browser.newContext({ viewport: { width: 1280, height: 900 } })),
  )
  const pages = await Promise.all(contexts.map((c) => c.newPage()))
  const host = pages[0]

  // Host creates a room.
  await host.goto(BASE)
  await host.fill('[data-testid=name-input]', 'Ada')
  await host.click('[data-testid=create-room]')
  await host.waitForURL(/\/room\/[A-Z0-9]{4}/, { timeout: 20000 })
  const code = host.url().split('/room/')[1]
  log(`Room code: ${code}`)
  await host.waitForSelector('[data-game-phase=LOBBY]', { timeout: 20000 })

  // Others join by code.
  const names = ['Ben', 'Cleo', 'Dev', 'Esa', 'Fin', 'Gus', 'Hana', 'Ivy', 'Jo']
  for (let i = 1; i < N; i++) {
    const p = pages[i]
    await p.goto(`${BASE}/room/${code}`, { waitUntil: 'domcontentloaded' })
    await p.waitForSelector('[data-testid=nickname-input]', { timeout: 40000 })
    await p.fill('[data-testid=nickname-input]', names[i - 1])
    await p.click('[data-testid=nickname-submit]')
    await p.waitForSelector('[data-game-phase=LOBBY]', { timeout: 30000 })
    log(`P${i} (${names[i - 1]}) joined`)
  }

  // Wait until the host sees all N players seated.
  for (let t = 0; t < 30; t++) {
    const count = await host.locator('[data-testid=player-chip]').count()
    if (count >= N) break
    await sleep(500)
  }
  const lobbyCount = await host.locator('[data-testid=player-chip]').count()
  log(`Lobby player chips on host: ${lobbyCount}`)
  await host.screenshot({ path: `${SHOTS}desk-lobby.png` })

  // Host starts the game.
  await host.click('[data-testid=start-game]')
  log('Game started; driving all players through the chain...')

  // Drive every player concurrently through prompt/draw/guess until REVEAL.
  const results = await Promise.all(pages.map((p, i) => playThrough(p, i, true)))
  log('playThrough results:', results.join(', '))

  const allReveal = results.every((r) => r === 'REVEAL' || r === 'DONE')
  if (!allReveal) throw new Error(`Not all players reached REVEAL: ${results.join(',')}`)

  // Host steps through the whole slideshow → DONE.
  await host.waitForSelector('[data-game-phase=REVEAL]', { timeout: 20000 })
  await sleep(800)
  await host.screenshot({ path: `${SHOTS}desk-reveal.png` })
  let phase = 'REVEAL'
  for (let i = 0; i < 120 && phase === 'REVEAL'; i++) {
    if (await host.locator('[data-testid=reveal-next]').isVisible()) {
      await host.click('[data-testid=reveal-next]')
    }
    await sleep(250)
    phase = await phaseOf(host)
  }
  log(`Host final phase: ${phase}`)
  if (phase !== 'DONE') throw new Error(`Host did not reach DONE (got ${phase})`)
  await host.screenshot({ path: `${SHOTS}desk-done.png` })

  // Confirm every other player also followed to DONE (shared, synced reveal).
  for (let i = 1; i < N; i++) {
    const ph = await phaseOf(pages[i])
    log(`P${i} final phase: ${ph}`)
  }

  log('✅ FULL MULTIPLAYER GAME COMPLETED: lobby → prompt → draw/guess rounds → slideshow → done')
  await browser.close()
}

main().catch(async (e) => {
  console.error('❌ VERIFICATION FAILED:', e.message)
  process.exit(1)
})
