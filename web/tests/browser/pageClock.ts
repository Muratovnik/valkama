import type { Page } from '@playwright/test'

/** The pages whose clock stands (`standClock`): their time passes only as the test runs it. */
const standing = new WeakSet<Page>()

/** How far the page's clock runs on as it is stopped: more than a round trip to it takes. */
const STAND_MS = 1000

/**
 * Stops the page's clock, which the spec installed before the page opened (`page.clock.install`),
 * so that from now on only the test moves it (`page.clock.runFor`): every delay of the page's own
 * then runs as long as the test says, however long the machine takes over the test's own steps.
 * It first runs on for `STAND_MS`, since the clock can only be stopped ahead of where it stands.
 *
 * That leap ages whatever the page has under way as it stands: a wait that began before it, such
 * as a download still arriving, is `STAND_MS` older on the page's clock than on the wall, so a
 * check whose verdict depends on such a wait lets it end before the clock stands.
 */
export async function standClock(page: Page) {
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + STAND_MS)
  standing.add(page)
}

/** Lets the page's clock go on with the wall again (`standClock`). */
export async function resumeClock(page: Page) {
  standing.delete(page)
  await page.clock.resume()
}

/** Whether the page's clock stands, stopped by `standClock`. */
export const stands = (page: Page) => standing.has(page)
