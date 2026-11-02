import { expect } from '@playwright/test'

import { test } from './test.ts'

// The report of a crash is only read when one is rare, so a browser upgrade that
// stopped sending the event would go unnoticed until the crash it was kept for.
test('a renderer that dies is named by the browser', async ({ page, rendererExits }) => {
  test.setTimeout(60_000)
  await page.goto('/tests/browser/harness.html?surface=context-bar')
  await page.goto('chrome://crash').catch(() => {})
  // The browser hears of a death when the process is gone, and Windows Error Reporting
  // holds a crashed process first: its two log entries stood up to 14 s apart here.
  await expect
    .poll(() => rendererExits.map((exit) => exit.status), { timeout: 45_000 })
    .toEqual(['crashed'])
  expect(rendererExits[0].errorCode).not.toBe(0)
})
