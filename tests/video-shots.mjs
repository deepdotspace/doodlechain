/**
 * Capture crisp 2x screenshots of the live Doodle Chain game for the promo video,
 * with intentional, recognizable drawing content (a sun), saved straight into the
 * video engine's public/captures dir so the storyboard can reference them.
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const BASE = 'https://doodlechain.app.space'
const OUT = '/Users/harshkathiriya/Downloads/deepspace-video-generation-engine/public/captures/doodlechain'
mkdirSync(OUT, { recursive: true })
const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const phaseOf = async (p) => {
  try { return await p.locator('[data-game-phase]').first().getAttribute('data-game-phase', { timeout: 2000 }) } catch { return null }
}

async function drawSun(page) {
  const box = await page.locator('[data-testid=drawing-canvas]').boundingBox()
  if (!box) return
  const cx = box.x + box.width * 0.5
  const cy = box.y + box.height * 0.46
  const r = box.width * 0.16
  // Circle body.
  await page.mouse.move(cx + r, cy)
  await page.mouse.down()
  for (let a = 0; a <= 360; a += 12) {
    const rad = (a * Math.PI) / 180
    await page.mouse.move(cx + Math.cos(rad) * r, cy + Math.sin(rad) * r)
  }
  await page.mouse.up()
  // Rays.
  for (let a = 0; a < 360; a += 45) {
    const rad = (a * Math.PI) / 180
    await page.mouse.move(cx + Math.cos(rad) * r * 1.25, cy + Math.sin(rad) * r * 1.25)
    await page.mouse.down()
    await page.mouse.move(cx + Math.cos(rad) * r * 1.7, cy + Math.sin(rad) * r * 1.7)
    await page.mouse.up()
  }
  // Smile.
  await page.mouse.move(cx - r * 0.5, cy + r * 0.15)
  await page.mouse.down()
  await page.mouse.move(cx, cy + r * 0.55)
  await page.mouse.move(cx + r * 0.5, cy + r * 0.15)
  await page.mouse.up()
}

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 })
const p = await ctx.newPage()

await p.goto(BASE)
await p.waitForSelector('[data-testid=app-root]')
await p.fill('[data-testid=name-input]', 'Sunny')
await p.screenshot({ path: `${OUT}/00-home.png` })
await p.click('[data-testid=create-room]')
await p.waitForURL(/\/room\/[A-Z0-9]{4}/)
await p.waitForSelector('[data-game-phase=LOBBY]')
await sleep(900)
for (let i = 0; i < 3; i++) { await p.click('[data-testid=add-bot]'); await sleep(350) }
await sleep(700)
await p.screenshot({ path: `${OUT}/01-lobby.png` })
log('lobby shot')
await p.click('[data-testid=start-game]')

const shot = {}
for (let guard = 0; guard < 80; guard++) {
  const phase = await phaseOf(p)
  if (phase === 'DONE') break
  try {
    if (phase === 'PROMPT' && (await p.locator('[data-testid=prompt-input]').isVisible())) {
      await p.fill('[data-testid=prompt-input]', 'a smiling sun on holiday')
      if (!shot.PROMPT) { await sleep(300); await p.screenshot({ path: `${OUT}/02-prompt.png` }); shot.PROMPT = 1; log('prompt shot') }
      await p.click('[data-testid=prompt-send]')
    } else if (phase === 'DRAW' && (await p.locator('[data-testid=draw-done]').isVisible())) {
      if (!shot.DRAW) { await drawSun(p); await sleep(300); await p.screenshot({ path: `${OUT}/03-draw.png` }); shot.DRAW = 1; log('draw shot'); await p.click('[data-testid=draw-done]') }
      else { await p.click('[data-testid=draw-done]') }
    } else if (phase === 'GUESS' && (await p.locator('[data-testid=guess-input]').isVisible())) {
      if (!shot.GUESS) { await sleep(300); await p.screenshot({ path: `${OUT}/04-guess.png` }); shot.GUESS = 1; log('guess shot') }
      await p.fill('[data-testid=guess-input]', 'a happy sunshine')
      await p.click('[data-testid=guess-send]')
    } else if (phase === 'REVEAL') {
      await sleep(600)
      if (!shot.REVEAL) { await p.screenshot({ path: `${OUT}/05-reveal.png` }); shot.REVEAL = 1; log('reveal shot') }
      // Step forward a couple links, capturing a richer reveal.
      if (await p.locator('[data-testid=reveal-next]').isVisible()) await p.click('[data-testid=reveal-next]')
      await sleep(700)
      if (!shot.REVEAL2) { await p.screenshot({ path: `${OUT}/06-reveal2.png` }); shot.REVEAL2 = 1; log('reveal2 shot') }
      if (await p.locator('[data-testid=reveal-next]').isVisible()) await p.click('[data-testid=reveal-next]')
    }
  } catch (e) { log(`act err ${phase}:`, e.message.split('\n')[0]) }
  await sleep(550)
}
log(`done. shots: ${Object.keys(shot).join(',')}`)
await browser.close()
