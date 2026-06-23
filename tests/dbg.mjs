import { chromium } from 'playwright'
const b = await chromium.launch()
const p = await (await b.newContext()).newPage()
const errs = []
p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 220)) })
p.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message.slice(0, 220)))
const code = process.argv[2] || 'EEUT'
await p.goto(`https://doodlechain.app.space/room/${code}`, { waitUntil: 'load' })
await new Promise((r) => setTimeout(r, 5000))
console.log('URL:', p.url())
console.log('phase count:', await p.locator('[data-game-phase]').count())
console.log('nickname count:', await p.locator('[data-testid=nickname-input]').count())
console.log('body:', (await p.locator('body').innerText()).slice(0, 240).replace(/\n/g, ' | '))
console.log('ERRORS:', errs.slice(0, 8).join(' || ') || 'none')
await b.close()
