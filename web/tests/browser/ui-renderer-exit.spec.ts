import { expect } from '@playwright/test'

import { test, watchRendererExits } from './test.ts'

// The report of a crash is only read when one is rare, so a browser upgrade that
// stopped sending the event would go unnoticed until the crash it was kept for.
test('a renderer that dies is named by the browser', async ({ browser, page }) => {
  const watch = await watchRendererExits(browser)
  await page.goto('chrome://crash').catch(() => {})
  await expect.poll(() => watch.exits.length).toBe(1)
  await watch.stop()
  expect(watch.exits[0].status).toBe('crashed')
})
