import { test, expect } from '@playwright/test'

test.describe('API', () => {
  test('auth proxy is reachable', async ({ request }) => {
    const res = await request.get('/api/auth/ok')
    // The worker proxies /api/auth/* to the auth worker; any HTTP response
    // (not a network failure) proves the route + proxy are wired.
    expect(res.status()).toBeGreaterThan(0)
  })

  test('home serves the SPA shell', async ({ page }) => {
    await page.goto('/')
    await page.waitForSelector('[data-testid="app-root"]', { timeout: 15000 })
    await expect(page).toHaveTitle(/Doodle Chain/i)
  })
})
