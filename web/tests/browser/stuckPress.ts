import type { Locator, Page } from '@playwright/test'

/**
 * A press where the pointer is. `locator.click` scrolls its target into view first,
 * and a stuck element's own place is above the fold: it moved the scroller by itself
 * before it pressed, which a reader's hand never does. Its retries scroll again, each
 * to another alignment, so how far the card moved depended on how many it took.
 */
export async function pressWhereItStands(page: Page, target: Locator) {
  // The strip scrolls inside itself where one row cannot hold it, as a thumb would.
  await target.evaluate((node) => {
    node.scrollIntoView({
      block: 'nearest',
      inline: 'nearest',
      container: 'nearest',
    } as ScrollIntoViewOptions)
  })
  const box = await target.boundingBox()
  await page.mouse.move(
    (box?.x ?? 0) + (box?.width ?? 0) / 2,
    (box?.y ?? 0) + (box?.height ?? 0) / 2,
  )
  await page.mouse.down()
  await page.mouse.up()
}
