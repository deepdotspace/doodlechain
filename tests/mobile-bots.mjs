/**
 * Mobile + bots verification — a single human player on a phone-sized viewport
 * creates a room, fills it with AI bots, and plays a full game (the bots are
 * driven server-side). Screenshots every phase at mobile width.
 */
import { chromium, devices } from 'playwright'
import { mkdirSync } from 'node:fs'

const BASE = process.argv[2] || 'https://doodlechain.app.space'
const SHOTS = new URL('../docs/founder/phase5/shots/', import.meta.url).pathname
mkdirSync(SHOTS, { recursive: true })
const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function phaseOf(page) {
  try { return await page.locator('[data-game-phase]').first().getAttribute('data-game-phase', { timeout: 2000 }) } catch { return null }
}
async function drawOnCanvas(page) {
  const box = await page.locator('[data-testid=drawing-canvas]').boundingBox()
  if (!box) return
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.35)
  await page.mouse.down()
  for (let t = 0; t <= 10; t++) await page.mouse.move(box.x + box.width * (0.3 + t * 0.04), box.y + box.height * (0.35 + Math.sin(t) * 0.08))
  await page.mouse.up()
}

const browser = await chromium.launch()
const ctx = await browser.newContext({ ...devices['iPhone 13'] })
const p = await ctx.newPage()

await p.goto(BASE)
await p.screenshot({ path: `${SHOTS}mobile-home.png` })
await p.fill('[data-testid=name-input]', 'Mia')
await p.click('[data-testid=create-room]')
await p.waitForURL(/\/room\/[A-Z0-9]{4}/)
const code = p.url().split('/room/')[1]
log(`Room ${code}; adding 3 bots`)
await p.waitForSelector('[data-game-phase=LOBBY]')
await sleep(1200)
for (let i = 0; i < 3; i++) { await p.click('[data-testid=add-bot]'); await sleep(400) }
await sleep(800)
await p.screenshot({ path: `${SHOTS}mobile-lobby.png` })
await p.click('[data-testid=start-game]')
log('started')

const shot = {}
for (let guard = 0; guard < 80; guard++) {
  const phase = await phaseOf(p)
  if (phase === 'DONE') break
  try {
    if (phase === 'PROMPT' && (await p.locator('[data-testid=prompt-input]').isVisible())) {
      if (!shot.PROMPT) { await p.screenshot({ path: `${SHOTS}mobile-prompt.png` }); shot.PROMPT = 1 }
      await p.fill('[data-testid=prompt-input]', 'a cat surfing a pizza')
      await p.click('[data-testid=prompt-send]')
    } else if (phase === 'DRAW' && (await p.locator('[data-testid=draw-done]').isVisible())) {
      await drawOnCanvas(p)
      if (!shot.DRAW) { await p.screenshot({ path: `${SHOTS}mobile-draw.png` }); shot.DRAW = 1 }
      await p.click('[data-testid=draw-done]')
    } else if (phase === 'GUESS' && (await p.locator('[data-testid=guess-input]').isVisible())) {
      if (!shot.GUESS) { await p.screenshot({ path: `${SHOTS}mobile-guess.png` }); shot.GUESS = 1 }
      await p.fill('[data-testid=guess-input]', 'a happy blob')
      await p.click('[data-testid=guess-send]')
    } else if (phase === 'REVEAL') {
      if (!shot.REVEAL) { await sleep(600); await p.screenshot({ path: `${SHOTS}mobile-reveal.png` }); shot.REVEAL = 1 }
      if (await p.locator('[data-testid=reveal-next]').isVisible()) await p.click('[data-testid=reveal-next]')
    }
  } catch (e) { log(`act err ${phase}:`, e.message.split('\n')[0]) }
  await sleep(600)
}
log(`final phase: ${await phaseOf(p)}; shots: ${Object.keys(shot).join(',')}`)
await browser.close()
