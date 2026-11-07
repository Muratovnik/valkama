import type { Locator } from '@playwright/test'

/**
 * Two frames after `node`'s page last changed. Under reduced motion the shell turns every change
 * of a property into a 0.01ms transition (shell.css), which ends a frame later: a class that a
 * component adds on mount reaches its computed style only after the next frame is drawn, so a
 * measurement taken at once reads the state before it.
 */
export const frames = (node: Locator) =>
  node.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  )
