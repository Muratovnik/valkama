import { expect } from '@playwright/test'

import { test } from './test.ts'

// The report of a crash is only read when one is rare, so a browser upgrade that
// stopped sending the event would go unnoticed until the crash it was kept for.
test('a renderer that dies is named by the browser', async ({ page, rendererExits }) => {
  test.setTimeout(60_000)
  await page.goto('/tests/browser/harness.html?surface=context-bar')
  await page.goto('chrome://crash').catch(() => {})
  // The event came 0.2 to 18.5 s after the crash over four full runs, loaded or not: the
  // browser hears when the process is gone, and the system's crash reporter may hold it.
  await expect
    .poll(() => rendererExits.map((exit) => exit.status), { timeout: 45_000 })
    .toEqual(['crashed'])
  expect(rendererExits[0].errorCode).not.toBe(0)
})
