/**
 * A write or a read held back until the test lets it go, and where focus stands while and after
 * it waits. A form disables its controls while a write or a read waits, and Chrome takes focus
 * off a control disabled under it, to the page (DESIGN.md, «Accessibility»).
 */
import { expect } from '@playwright/test'
import type { Locator, Page, Route } from '@playwright/test'

/** A promise the test settles itself, to hold back an answer until it calls `release`. */
export function holdBack() {
  let settle: ((value: undefined) => void) | undefined
  const held = new Promise<undefined>((done) => {
    settle = done
  })
  return { held, release: () => settle?.(undefined) }
}

/** The server's own sentence for a refusal the specs of a held wait answer with. */
export const REASON = 'The store is read-only for maintenance.'

/** A write refused with {@link REASON}. */
export const refuse = (route: Route) =>
  route.fulfill({ status: 400, json: { error: { code: 'invalid_request', message: REASON } } })

/** A read that failed, the server saying {@link REASON}. */
export const failRead = (route: Route) => route.fulfill({ status: 500, body: REASON })

/**
 * Every write to `path` held back until `release`, then answered by `answer`: refused with
 * {@link REASON} unless the test says otherwise. Reads under the same path pass, unless `reads`
 * says they are held too.
 */
export async function heldWrites(
  page: Page,
  path: string,
  answer: (route: Route) => Promise<void> = refuse,
  reads = false,
) {
  const { held, release } = holdBack()
  const sent: unknown[] = []
  await page.route(`**${path}`, async (route) => {
    if (!reads && route.request().method() === 'GET') return route.fallback()
    sent.push(route.request().postDataJSON())
    await held
    return answer(route)
  })
  return { release, sent }
}

/** Focus has gone to the page: what held it was disabled under it. */
export const onThePage = (page: Page) =>
  expect.poll(() => page.evaluate(() => document.activeElement === document.body)).toBe(true)

/** `control` has the focus, ringed as a key puts it. */
export async function focusedByKey(control: Locator) {
  await expect(control).toBeFocused()
  expect(await control.evaluate((node) => node.matches(':focus-visible'))).toBe(true)
}

/** What has focus, by its id or its name: the same control read twice reads the same. */
export const focusName = (page: Page) =>
  page.evaluate(() => {
    const now = document.activeElement
    return !now || now === document.body
      ? ''
      : now.id || now.getAttribute('aria-label') || (now.textContent ?? '').trim()
  })

/** Where the next Tab from `control` goes while nothing waits. */
export async function onwardFrom(page: Page, control: Locator) {
  await control.focus()
  await page.keyboard.press('Tab')
  const onward = await focusName(page)
  expect(onward).not.toBe('')
  return onward
}

/**
 * Presses `key` on `control` with its write held: the control is disabled under focus, which
 * falls to the page, and a second press while it waits sends nothing more. Says where a Tab
 * from the control went before it was pressed.
 */
export async function pressHeld(
  page: Page,
  control: Locator,
  key: string,
  sent: readonly unknown[],
) {
  const onward = await onwardFrom(page, control)
  await control.focus()
  await page.keyboard.press(key)
  await expect(control).toBeDisabled()
  await onThePage(page)
  await page.keyboard.press(key)
  expect(sent).toHaveLength(1)
  return onward
}

/** The next Tab goes on to `onward`, where it went from the control before the wait. */
export async function tabGoesOn(page: Page, onward: string) {
  await page.keyboard.press('Tab')
  expect(await focusName(page)).toBe(onward)
}
