/**
 * Where the keyboard's focus stands in a `DialogFrame` window against what the window says over
 * its foot, by the rule in DESIGN.md («Dialogs and drawers»): no control focused in the window's
 * body stands under what the form says of a change or why a save was refused, not even in part
 * and not its focus ring (WCAG 2.4.11, Focus Not Obscured, asks only that it not be hidden
 * whole). Read by the frame's hooks: its body `data-part="dialog-body"`, the box of those words
 * `data-part="said"`.
 */
import type { Locator, Page } from '@playwright/test'

/** One stop of the walk: the focused control, and how far it and its ring are hidden. */
export interface FocusStop {
  /**
   * How far the control and its ring stand at or past the words' top: under the words over the
   * foot, or out of sight beyond them.
   */
  covered: number
  height: number
  name: string
  /** Where the ring's lower side stands, under the body's top edge. */
  ringBottom: number
  /** Where the words' top stands, under the body's top edge; `null` while nothing is said. */
  wordsTop: number | null
}

/**
 * The control focused in `node`'s body, measured; `null` when the focus is outside the body or
 * in the words. Run in the page, so it names nothing outside itself.
 */
function readStop(node: Element): FocusStop | null {
  const focused = document.activeElement
  const said = node.querySelector('[data-part="said"]')
  const body = node.querySelector('[data-part="dialog-body"]')
  if (!(focused instanceof HTMLElement) || !body?.contains(focused)) return null
  if (said?.contains(focused)) return null
  const box = focused.getBoundingClientRect()
  const style = getComputedStyle(focused)
  const ring =
    style.outlineStyle === 'none'
      ? 0
      : Number.parseFloat(style.outlineWidth) + Number.parseFloat(style.outlineOffset)
  const top = box.top - ring
  const bottom = box.bottom + ring
  const shownTop = body.getBoundingClientRect().top + body.clientTop
  const words = said?.getBoundingClientRect()
  return {
    covered: words ? Math.max(0, bottom - Math.max(top, words.top)) : 0,
    height: box.height,
    name: (focused.getAttribute('aria-label') ?? focused.textContent).trim().slice(0, 40),
    ringBottom: bottom - shownTop,
    wordsTop: words ? words.top - shownTop : null,
  }
}

/** The control focused in the dialog's body as it stands now, or `null` outside the body. */
export const focusStop = (dialog: Locator) => dialog.evaluate(readStop)

/**
 * Presses Tab, or Shift+Tab with `back`, from `from` until focus leaves the dialog's body or
 * `most` presses, and reads each control focused in the body. The caller has made the window say
 * something there first.
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
    const stop = await focusStop(dialog)
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
