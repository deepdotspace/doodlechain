import { test, expect } from '@playwright/test'
import { captureConsoleErrors } from './helpers/errors'

/** The app shell mounts under data-testid="app-root". */
async function waitForApp(page: import('@playwright/test').Page) {
  await page.waitForSelector('[data-testid="app-root"]', { timeout: 15000 })
}

test.describe('Doodle Chain smoke', () => {
  test('home loads without JS errors and shows the entry controls', async ({ page }) => {
    const errors = captureConsoleErrors(page)
    await page.goto('/')
    await waitForApp(page)
    await expect(page.getByTestId('name-input')).toBeVisible()
    await expect(page.getByTestId('create-room')).toBeVisible()
    expect(errors).toEqual([])
  })

  test('naming yourself enables creating a room', async ({ page }) => {
    await page.goto('/')
    await waitForApp(page)
    await expect(page.getByTestId('create-room')).toBeDisabled()
    await page.getByTestId('name-input').fill('Tester')
    await expect(page.getByTestId('create-room')).toBeEnabled()
  })

  test('unknown route shows the friendly 404', async ({ page }) => {
    await page.goto('/nonexistent-page-xyz')
    await waitForApp(page)
    await expect(page.getByText('wandered off')).toBeVisible()
  })
})
