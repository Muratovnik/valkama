import { expect } from '@playwright/test'

import { test } from './test.ts'

// The report of a crash is only read when one is rare, so a browser upgrade that
// stopped sending the event would go unnoticed until the crash it was kept for.
test('a renderer that dies is named by the browser', async ({ page, rendererExits }) => {
  await page.goto('/tests/browser/harness.html?surface=context-bar')
  await page.goto('chrome://crash').catch(() => {})
  await expect.poll(() => rendererExits.map((exit) => exit.status)).toEqual(['crashed'])
  expect(rendererExits[0].errorCode).not.toBe(0)
})
