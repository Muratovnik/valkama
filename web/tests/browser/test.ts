import { test as base } from '@playwright/test'

interface RendererExit {
  errorCode: number
  status: string
}

/**
 * The suite's `test`: Playwright's, with any renderer death attached to the test
 * that saw it, since a crash this rare is read once, from those artifacts.
 *
 * Playwright reports every such death as "Page crashed" or "Target crashed", and
 * the trace it keeps says no more. A killed renderer and one with an access
 * violation leave nothing in the browser log either; only this event tells them
 * apart. It does not cover running out of memory: that renderer hangs and never
 * reports, so the test fails on its timeout.
 */
export const test = base.extend<{ rendererExits: RendererExit[] }>({
  rendererExits: [
    async ({ browser }, use, testInfo) => {
      const session = await browser.newBrowserCDPSession()
      const exits: RendererExit[] = []
      session.on('Target.targetCrashed', ({ errorCode, status }) => {
        exits.push({ errorCode, status })
      })
      await session.send('Target.setDiscoverTargets', { discover: true })
      await use(exits)
      // A round trip, so a death the test already saw has been heard here too.
      await session.send('Target.getTargets').catch(() => {})
      await session.detach().catch(() => {})
      if (exits.length === 0) return
      const lines = exits.map(
        ({ errorCode, status }) =>
          `status=${status} errorCode=0x${(errorCode >>> 0).toString(16).toUpperCase()}`,
      )
      await testInfo.attach('renderer-exit', { body: lines.join('\n'), contentType: 'text/plain' })
    },
    { auto: true },
  ],
})
