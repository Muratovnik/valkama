import { expect } from '@playwright/test'

import { test } from './test.ts'

// The report of a crash is only read when one is rare, so a browser upgrade that
// stopped sending the event would go unnoticed until the crash it was kept for.
test('a renderer that dies is named by the browser', async ({ browser, page, rendererExits }) => {
  const session = await browser.newBrowserCDPSession()
  await page.goto('/tests/browser/harness.html?surface=context-bar')
  await page.goto('chrome://crash').catch(() => {})
  // A round trip in each look, as the suite's `test` makes before it reads: on a full
  // run the event can wait for the next exchange with the browser.
  await expect
    .poll(async () => {
      await session.send('Target.getTargets')
      return rendererExits.map((exit) => exit.status)
    })
    .toEqual(['crashed'])
  expect(rendererExits[0].errorCode).not.toBe(0)
})
