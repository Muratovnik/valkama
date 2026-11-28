import { basename } from 'node:path'

import { test as base } from '@playwright/test'

import { usesSystemClipboard } from './clipboardSpecs.ts'
import { keepTestOutput, shotRunVariable } from './keptShots.ts'
import { keepClipboardInPage, refuseClipboardGrant } from './pageClipboard.ts'
import { timedProject, timedTag } from './timedChecks.ts'

interface RendererExit {
  errorCode: number
  status: string
}

/**
 * The suite's `test`: Playwright's, with what each test wrote and attached kept past
 * the run, with any renderer death attached to the test that saw it, since a crash
 * this rare is read once, from those artifacts, and with a test that bounds a time failed
 * in any project but the one that runs it alone (`timedChecks.ts`), and, in a spec off the
 * clipboard list (`clipboardSpecs.ts`), with the page's clipboard (`pageClipboard.ts`) in every
 * context the test opens, before its first page: the test's `context` and any it makes itself
 * through `browser.newContext` or `browser.newPage`.
 *
 * Playwright reports every such death as "Page crashed" or "Target crashed", and
 * the trace it keeps says no more. A killed renderer and one with an access
 * violation leave nothing in the browser log either; only this event tells them
 * apart. It does not cover running out of memory: that renderer hangs and never
 * reports, so the test fails on its timeout.
 */
export const test = base.extend<{
  clipboardKept: undefined
  keptOutput: undefined
  rendererExits: RendererExit[]
  timedAlone: undefined
}>({
  // First of the suite's own, so it is set up first and torn down last: Playwright tears a
  // test's fixtures down in the reverse of their setup, and the renderer's death is
  // attached as its fixture is torn down.
  keptOutput: [
    // oxlint-disable-next-line no-empty-pattern -- Playwright reads a fixture's needs from this pattern, and this one needs none
    async ({}, use, testInfo) => {
      await use(undefined)
      const run = process.env[shotRunVariable]
      if (run) keepTestOutput(testInfo, run)
    },
    { auto: true },
  ],
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
  // A test that bounds a time runs alone, after the rest (`timedChecks.ts`). The timed project
  // takes the production specs alone, so a tagged test anywhere else fails here, rather than
  // run beside the other workers or not at all.
  timedAlone: [
    // oxlint-disable-next-line no-empty-pattern -- Playwright reads a fixture's needs from this pattern, and this one needs none
    async ({}, use, testInfo) => {
      if (testInfo.tags.includes(timedTag) && testInfo.project.name !== timedProject)
        throw new Error(
          `${testInfo.title} is tagged ${timedTag} and runs in ${testInfo.project.name}: ` +
            `a timed test runs only in ${timedProject}, which takes the production specs`,
        )
      await use(undefined)
    },
    { auto: true },
  ],
  // Playwright's `page` opens in this context, so the page's first document meets the page's
  // clipboard. A grant the configuration or `test.use` asks for fails before the context opens.
  context: async ({ context, permissions }, use, testInfo) => {
    if (!usesSystemClipboard(testInfo.file)) {
      const spec = basename(testInfo.file)
      refuseClipboardGrant(spec, permissions)
      await keepClipboardInPage(context, spec)
    }
    await use(context)
  },
  // A context the test opens itself gets the page's clipboard as it opens, as Playwright's own
  // does here, since Playwright opens that one the same way.
  clipboardKept: [
    async ({ browser }, use, testInfo) => {
      if (usesSystemClipboard(testInfo.file)) {
        await use(undefined)
        return
      }
      const spec = basename(testInfo.file)
      const open = browser.newContext.bind(browser)
      browser.newContext = async (options) => {
        refuseClipboardGrant(spec, options?.permissions)
        const context = await open(options)
        await keepClipboardInPage(context, spec)
        return context
      }
      try {
        await use(undefined)
      } finally {
        // The worker's browser goes on to the next test with its own method again.
        Reflect.deleteProperty(browser, 'newContext')
      }
    },
    { auto: true },
  ],
})
