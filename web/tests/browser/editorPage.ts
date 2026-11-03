import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { installDiscussionBackend } from './discussionBackend.ts'
import { projectScope } from './planningFixtures.ts'

/**
 * A card open with its comment field in reach, and how to read what a field is doing.
 * `prepare` installs what a test adds to the backend, which must come after it.
 */
export async function openCard(page: Page, prepare?: () => Promise<unknown>) {
  const backend = await installDiscussionBackend(page)
  await prepare?.()
  await page.goto(serializePlatformRoute({ module_id: 'planning', scope: projectScope }))
  await page.locator('.work-item-column[data-state="dev"] .work-item-tile').first().click()
  const drawer = page.locator('.drawer')
  await expect(drawer).toHaveCSS('transform', 'none')
  const comment = drawer.locator('.discussion-form').getByRole('textbox')
  await expect(comment).toBeVisible()
  return { backend, drawer, comment }
}

export const select = (field: Locator, start: number, end: number) =>
  field.evaluate(
    (element: HTMLTextAreaElement, range) => {
      element.focus()
      element.setSelectionRange(range[0], range[1])
    },
    [start, end],
  )
export const selection = (field: Locator) =>
  field.evaluate((element: HTMLTextAreaElement) => [element.selectionStart, element.selectionEnd])
/** How many lines the text box stands, by its own line height and inset. */
export const linesTall = (field: Locator) =>
  field.evaluate((element) => {
    const style = getComputedStyle(element)
    const inset = Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom)
    return (element.clientHeight - inset) / Number.parseFloat(style.lineHeight)
  })
/** The focus colour as the page resolves it, to compare an edge against. */
export const focusColour = (page: Page) =>
  page.evaluate(() => {
    const probe = document.createElement('span')
    probe.style.color = 'var(--color-focus-ring)'
    document.body.append(probe)
    const colour = getComputedStyle(probe).color
    probe.remove()
    return colour
  })
export async function box(locator: Locator) {
  const bounds = await locator.boundingBox()
  if (!bounds) throw new Error('not laid out')
  return bounds
}

/**
 * A box once it has stopped moving. The card's head folds as its body scrolls, and
 * takes the body up with it for a moment: a box read on the way is not where it
 * stands, and two reads apart would blame whatever happened between them.
 */
export async function settledBox(locator: Locator) {
  let last: Awaited<ReturnType<typeof box>> | null = null
  await expect
    .poll(async () => {
      const previous = last
      last = await box(locator)
      // The poll waits between reads, so one read has nothing to compare with yet.
      return previous !== null && last.y === previous.y && last.height === previous.height
    })
    .toBe(true)
  return box(locator)
}
