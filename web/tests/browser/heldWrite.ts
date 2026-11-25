/**
 * A write or a read held back until the test lets it go, and where focus stands while and after
 * it waits. A form disables its controls while a write or a read waits, and Chrome takes focus
 * off a control disabled under it, to the page (DESIGN.md, «Accessibility»).
 */
import { expect } from '@playwright/test'
import type { Locator, Page, Route } from '@playwright/test'

import { frames } from './frames.ts'

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

/**
 * The card's reads held back from `hold` until `release`, as after a write that went through:
 * what it changed is then on the server and not yet on the card. `asked` counts the reads held.
 */
async function heldRereads(page: Page) {
  const { held, release } = holdBack()
  let holding = false
  let asked = 0
  await page.route('**/api/modules/planning/work-item?*', async (route) => {
    if (holding) {
      asked += 1
      await held
    }
    return route.fallback()
  })
  return {
    asked: () => asked,
    hold: () => {
      holding = true
    },
    release,
  }
}

/**
 * The card's reads held from the moment a write to `path` is sent until `release`, the write
 * itself answered as the double answers it: what it changed is then on the server and not yet
 * on the card. `asked` counts the reads held.
 */
export async function readHeldAfter(page: Page, path: string) {
  const reread = await heldRereads(page)
  await page.route(`**${path}`, (route) => {
    if (route.request().method() !== 'GET') reread.hold()
    return route.fallback()
  })
  return { asked: reread.asked, release: reread.release }
}

/**
 * Counts, from now until the returned call, each frame drawn after `part` has left the page in
 * which focus stood on nothing: on the page, or on a control disabled under it. `gone` is how
 * many frames were drawn with `part` away, so a count of none over none says nothing.
 */
export async function framesOnNothing(page: Page, part: Locator) {
  const node = await part.elementHandle()
  await page.evaluate((held) => {
    const count = { gone: 0, onNothing: 0, on: true }
    Object.assign(window, { framesOnNothing: count })
    const look = () => {
      if (!count.on) return
      if (!held?.isConnected) {
        count.gone += 1
        const now = document.activeElement
        if (!now || now === document.body || now.matches(':disabled')) count.onNothing += 1
      }
      requestAnimationFrame(look)
    }
    requestAnimationFrame(look)
  }, node)
  return () =>
    page.evaluate(() => {
      const { framesOnNothing: count } = window as unknown as {
        framesOnNothing: { gone: number; on: boolean; onNothing: number }
      }
      count.on = false
      return { gone: count.gone, onNothing: count.onNothing }
    })
}

/**
 * Whether `control` stands in sight: inside the window and every box around it that clips, and
 * not under anything drawn over it, such as a bar that sticks to the top of its scroller. Whole,
 * the middle of each of its edges must be; otherwise the middle of the part of it in sight.
 */
export const inSightClear = (control: Locator, whole = true) =>
  control.evaluate((node, all) => {
    const box = node.getBoundingClientRect()
    let top = 0
    let bottom = window.innerHeight
    let left = 0
    let right = window.innerWidth
    for (let around = node.parentElement; around; around = around.parentElement) {
      const style = getComputedStyle(around)
      if (/auto|scroll|hidden|clip/u.test(`${style.overflowX} ${style.overflowY}`)) {
        const frame = around.getBoundingClientRect()
        top = Math.max(top, frame.top)
        bottom = Math.min(bottom, frame.bottom)
        left = Math.max(left, frame.left)
        right = Math.min(right, frame.right)
      }
    }
    const shown = {
      top: Math.max(top, box.top),
      bottom: Math.min(bottom, box.bottom),
      left: Math.max(left, box.left),
      right: Math.min(right, box.right),
    }
    if (shown.top >= shown.bottom || shown.left >= shown.right) return false
    // The middle of each edge, just inside it: a rounded corner takes no hit.
    const inset = 2
    const across = (box.left + box.right) / 2
    const down = (box.top + box.bottom) / 2
    const points = all
      ? [
          [across, box.top + inset],
          [across, box.bottom - inset],
          [box.left + inset, down],
          [box.right - inset, down],
        ]
      : [[(shown.left + shown.right) / 2, (shown.top + shown.bottom) / 2]]
    // A box brought in by its nearest edge stands flush with it, at a fraction of a pixel.
    const within =
      box.top >= top - 1 &&
      box.bottom <= bottom + 1 &&
      box.left >= left - 1 &&
      box.right <= right + 1
    return (
      (!all || within) &&
      points.every(([x = 0, y = 0]) => {
        const hit = document.elementFromPoint(x, y)
        return hit !== null && node.contains(hit)
      })
    )
  }, whole)

/** Focus has gone to the page: what held it was disabled under it. */
export const onThePage = (page: Page) =>
  expect.poll(() => page.evaluate(() => document.activeElement === document.body)).toBe(true)

/** `control` has the focus, ringed as a key puts it. */
export async function focusedByKey(control: Locator) {
  await expect(control).toBeFocused()
  expect(await control.evaluate((node) => node.matches(':focus-visible'))).toBe(true)
}

/** What has focus, by its id or its name: the same control read twice reads the same. */
const focusName = (page: Page) =>
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

/** A press of the pointer at the middle of `control`, where a disabled one takes nothing. */
async function pressAt(page: Page, control: Locator) {
  const box = await control.boundingBox()
  if (!box) throw new Error('The control stands nowhere on the page')
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
}

/**
 * `control` pressed with `key`, its write held and then let through as `answer` says, the
 * double's own answer unless it says otherwise, and the card's read that follows held: the
 * control stays disabled while that read waits, whatever a second press by `second` does.
 * `release` lets the read go; `onward` is where a Tab from the control went before the press.
 */
export async function wentThrough(
  page: Page,
  control: Locator,
  write: { key: string; path: string; answer?: (route: Route) => Promise<void> },
  second: 'key' | 'pointer',
) {
  const reread = await heldRereads(page)
  const { release, sent } = await heldWrites(page, write.path, (route) => {
    reread.hold()
    return write.answer ? write.answer(route) : route.fallback()
  })
  const onward = await pressHeld(page, control, write.key, sent)

  release()
  await expect.poll(reread.asked).toBeGreaterThan(0)
  await frames(control)
  // What the write changed is on the server and not yet on the card.
  await (second === 'key' ? page.keyboard.press(write.key) : pressAt(page, control))
  await expect(control).toBeDisabled()
  return { onward, release: reread.release, sent }
}
