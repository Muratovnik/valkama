/**
 * A write held back until the test lets it go, and where focus stands while and after it waits.
 * A form disables its controls while a write waits, and Chrome takes focus off a control
 * disabled under it, to the page (DESIGN.md, «Accessibility»).
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

/** A promise the test settles itself, to hold back an answer until it calls `release`. */
export function holdBack() {
  let settle: ((value: undefined) => void) | undefined
  const held = new Promise<undefined>((done) => {
    settle = done
  })
  return { held, release: () => settle?.(undefined) }
}

/** Focus has gone to the page: what held it was disabled under it. */
export const onThePage = (page: Page) =>
  expect.poll(() => page.evaluate(() => document.activeElement === document.body)).toBe(true)

/** `control` has the focus, ringed as a key puts it. */
export async function focusedByKey(control: Locator) {
  await expect(control).toBeFocused()
  expect(await control.evaluate((node) => node.matches(':focus-visible'))).toBe(true)
}
