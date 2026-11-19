/**
 * A list of wide rows (`data-hint-list="wide-rows"`: the settings sheet, a card's checklist) puts
 * each hint inside its element's own row, beside the element: in the built app, at 1440px and
 * 1024px, every element with a hint in every row, the first and the last included, is pointed
 * at with its row in the middle of the window, and its hint must stand clear of the element,
 * between its row's top and bottom, so over neither the row before nor the row after, and no
 * more than 16px from the element. Past the sheet's edge, where a list of rows down puts it, a
 * setting's hint stood 375 to 576px from its control, and a long one, drawn narrower there, ran
 * four lines down over the next row.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { installBackend } from './backend.ts'
import { spaceScope } from './planningFixtures.ts'
import { openSteps, STEP_LIST } from './stepsPage.ts'
import { test } from './test.ts'

/** How far a hint may stand from its element, in px. */
const NEAR = 16

/**
 * What the hint shown under the pointer does wrong against `anchor`, the rows of its list and
 * the one it stands in (`index`): an empty list where it stands as it should.
 */
function wrongs(
  anchor: HTMLElement,
  [rowSelector, index, near]: [string, number, number],
): string[] | null {
  const hint = document.querySelector('.tooltip-hint')
  if (!hint) return null
  const rows = [...document.querySelectorAll(rowSelector)].map((row) => row.getBoundingClientRect())
  const shown = hint.getBoundingClientRect()
  const own = anchor.getBoundingClientRect()
  const row = rows[index]
  if (!row) return ['no row']
  // A pixel of the hint's border meeting a box is no cover.
  const covers = (box: DOMRect) =>
    Math.min(shown.right, box.right) - Math.max(shown.left, box.left) > 1 &&
    Math.min(shown.bottom, box.bottom) - Math.max(shown.top, box.top) > 1
  const found: string[] = []
  if (covers(own)) found.push('over its element')
  if (shown.top < row.top - 1 || shown.bottom > row.bottom + 1)
    found.push(
      `from ${shown.top} to ${shown.bottom}, out of its row from ${row.top} to ${row.bottom}`,
    )
  for (const [name, other] of [
    ['the row before', rows[index - 1]],
    ['the row after', rows[index + 1]],
  ] as const)
    if (other && covers(other)) found.push(`over ${name}`)
  const apart = Math.max(own.left - shown.right, shown.left - own.right)
  if (apart > near) found.push(`${Math.round(apart)}px from its element`)
  return found
}

/**
 * Points at every element with a hint in each of `rows`, its row in the middle of the window,
 * and lists what each hint does wrong; with the rows of the list where one showed.
 */
async function sweepRows(page: Page, rows: Locator, selector: string) {
  const viewport = page.viewportSize() ?? { width: 0, height: 0 }
  const found: string[] = []
  const pointed = new Set<number>()
  for (let index = 0, count = await rows.count(); index < count; index += 1) {
    const row = rows.nth(index)
    const anchors = row.locator('[data-tooltip]')
    for (let each = 0, many = await anchors.count(); each < many; each += 1) {
      const anchor = anchors.nth(each)
      await row.evaluate((element) => element.scrollIntoView({ block: 'center' }))
      const box = await anchor.boundingBox()
      if (!box || box.width < 2 || box.height < 2) continue
      // From a place with no hint, so the last one is gone and this one comes after the rest.
      await page.mouse.move(viewport.width - 2, viewport.height - 2)
      await page.clock.runFor(1000)
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await page.clock.runFor(1000)
      const name = await anchor.evaluate(
        (element) => `${element.classList[0] ?? element.tagName.toLowerCase()}`,
      )
      const wrong = await anchor.evaluate(wrongs, [selector, index, NEAR] as [
        string,
        number,
        number,
      ])
      // A label whose words are whole has no hint to show.
      if (!wrong) continue
      pointed.add(index)
      found.push(...wrong.map((what) => `row ${index} ${name}: ${what}`))
    }
  }
  return { found, pointed: [...pointed] }
}

for (const width of [1440, 1024]) {
  test.describe(`at ${width}px`, () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript(() => localStorage.setItem('valkama-locale', 'en'))
      await page.setViewportSize({ width, height: 900 })
      // The hint's delay runs on this clock, so each element is read after it.
      await page.clock.install()
    })

    test('a setting’s hint stands beside its control, inside its own row', async ({ page }) => {
      await installBackend(page)
      await page.goto(serializePlatformRoute({ module_id: 'settings', scope: spaceScope }))
      const rows = page.locator('.settings-sheet .settings-row')
      await expect(rows.first()).toBeVisible()
      const swept = await sweepRows(page, rows, '.settings-sheet .settings-row')
      // The colours, the alerts' switch, the check of the connection and the opening lanes: eight
      // of the sheet's seventeen rows show a hint, and the others' labels are whole.
      expect(swept.pointed.length).toBeGreaterThan(4)
      expect(swept.found).toEqual([])
    })

    test('a step’s hint stands beside its action, inside its own step', async ({ page }) => {
      await openSteps(page)
      const swept = await sweepRows(page, page.locator('.drawer .step-row'), '.drawer .step-row')
      // Every step, the first and the last among them.
      expect(swept.pointed).toEqual(STEP_LIST.map((_, index) => index))
      expect(swept.found).toEqual([])
    })
  })
}
