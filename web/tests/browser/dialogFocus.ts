/**
 * Where the keyboard's focus stands in a `DialogFrame` window against what the window says over
 * its foot, by the rule in DESIGN.md («Dialogs and drawers»): no control focused in the window's
 * body stands under what the form says of a change or why a save was refused, not even in part
 * (WCAG 2.4.11, Focus Not Obscured, asks only that it not be hidden whole). Read by the frame's
 * hooks: its body `data-part="dialog-body"`, the box of those words `data-part="said"`.
 */
import type { Locator, Page } from '@playwright/test'

/** One stop of the walk: the focused control and how many of its pixels the words cover. */
export interface FocusStop {
  covered: number
  height: number
  name: string
}

/**
 * Presses Tab, or Shift+Tab with `back`, from `from` until focus leaves the dialog's body or
 * `most` presses, and reads how far the box of the words over the foot covers each control
 * focused in the body. The caller has made the window say something there first.
 */
export async function walkFocus(
  page: Page,
  dialog: Locator,
  from: Locator,
  { back = false, most = 60 }: { back?: boolean; most?: number } = {},
): Promise<FocusStop[]> {
  await from.focus()
  const stops: FocusStop[] = []
  for (let press = 0; press < most; press++) {
    await page.keyboard.press(back ? 'Shift+Tab' : 'Tab')
    const stop = await dialog.evaluate((node) => {
      const focused = document.activeElement
      const said = node.querySelector('[data-part="said"]')
      const body = node.querySelector('[data-part="dialog-body"]')
      if (!(focused instanceof HTMLElement) || !body?.contains(focused)) return null
      if (!said || said.contains(focused)) return null
      const box = focused.getBoundingClientRect()
      const words = said.getBoundingClientRect()
      return {
        covered: Math.max(0, Math.min(box.bottom, words.bottom) - Math.max(box.top, words.top)),
        height: box.height,
        name: (focused.getAttribute('aria-label') ?? focused.textContent).trim().slice(0, 40),
      }
    })
    if (stop === null) break
    stops.push(stop)
  }
  return stops
}

/** Whether the dialog's body is longer than it shows, so the words over the foot cover some. */
export const bodyOverflows = (dialog: Locator) =>
  dialog.evaluate((node) => {
    const body = node.querySelector('[data-part="dialog-body"]')
    return Boolean(body && body.scrollHeight > body.clientHeight + 1)
  })
