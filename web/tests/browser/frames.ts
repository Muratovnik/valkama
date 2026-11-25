import type { Locator } from '@playwright/test'

/**
 * Two frames after `node`'s page last changed: what a component sets once it has measured
 * itself, in an observer's turn or the next frame, reaches the screen only after that frame is
 * drawn, so a measurement taken at once reads the state before it.
 */
export const frames = (node: Locator) =>
  node.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  )

/**
 * Once every motion of `node`'s page that ends has ended, such as a drawer sliding in: a box read
 * on its way is measured against where it has not yet come to rest. A motion that repeats for
 * ever is not waited on.
 */
export const motionsEnded = (node: Locator) =>
  node.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((one) => Number.isFinite(one.effect?.getComputedTiming().endTime))
        .map((one) => one.finished.catch(() => null)),
    ),
  )
