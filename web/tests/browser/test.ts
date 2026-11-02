import { test as base } from '@playwright/test'
import type { Browser } from '@playwright/test'

interface RendererExit {
  errorCode: number
  status: string
}

/**
 * Listens for the browser's own account of a renderer that died.
 *
 * Playwright reports every such death as "Page crashed" or "Target crashed",
 * and the trace it keeps says no more. A killed renderer and one with an access
 * violation leave nothing in the browser log either; only this event tells them
 * apart. It does not cover running out of memory: that renderer hangs and never
 * reports, so the test fails on its timeout.
 */
export async function watchRendererExits(browser: Browser) {
  const session = await browser.newBrowserCDPSession()
  const exits: RendererExit[] = []
  session.on('Target.targetCrashed', ({ status, errorCode }) => exits.push({ status, errorCode }))
  await session.send('Target.setDiscoverTargets', { discover: true })
  return {
    exits,
    /** Waits out a round trip, so a death the test already saw has been heard here too. */
    async stop() {
      await session.send('Target.getTargets').catch(() => {})
      await session.detach().catch(() => {})
    },
  }
}

/**
 * The suite's `test`: the same one, with any renderer death attached to the test
 * that saw it. A crash this rare is read once, from that test's artifacts.
 */
export const test = base.extend<{ rendererExits: undefined }>({
  rendererExits: [
    async ({ browser }, use, testInfo) => {
      const watch = await watchRendererExits(browser)
      await use(undefined)
      await watch.stop()
      if (watch.exits.length === 0) return
      const lines = watch.exits.map(
        ({ status, errorCode }) =>
          `status=${status} errorCode=0x${(errorCode >>> 0).toString(16).toUpperCase()}`,
      )
      await testInfo.attach('renderer-exit', { body: lines.join('\n'), contentType: 'text/plain' })
    },
    { auto: true },
  ],
})
