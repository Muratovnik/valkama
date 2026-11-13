/**
 * The colours the Analytics page draws its values in, as the browser computes them, by the key
 * each part writes on its marks: what a spec compares across the parts of a section, and across a
 * change of the view.
 */
import type { Page } from '@playwright/test'

/**
 * The computed fill of the first `mark` in each element `items` finds, or of the element itself
 * with no mark, by its `data-<key>`.
 */
const fillsBy = (page: Page, items: string, mark: string, key: string) =>
  page.locator(items).evaluateAll(
    (found, [inner, name = '']) =>
      Object.fromEntries(
        found.flatMap((item) => {
          const drawn = inner ? item.querySelector(inner) : item
          const named = (item as HTMLElement).dataset[name]
          return drawn && named ? [[named, getComputedStyle(drawn).backgroundColor]] : []
        }),
      ),
    [mark, key],
  )

/**
 * The colour each value, or pair, is drawn in by its key, as the page computes it: in its section's
 * tile on the rail, its bar, its small chart and the day columns' legend. A part that does not
 * draw a key has no entry for it.
 */
export async function hues(page: Page, section: string) {
  return {
    tile: await fillsBy(page, `[data-section="${section}"] .mini-share-part`, '', 'key'),
    bars: await fillsBy(page, '.spending-bars .ranked-line', '.ranked-bar', 'key'),
    multiples: await fillsBy(page, '.spending-multiples .multiple', '.multiple-column', 'key'),
    days: await fillsBy(page, '.spending-days .chart-key', '.chart-swatch', 'series'),
  }
}
