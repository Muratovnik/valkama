/**
 * The marks of the places on a quota window's step line, in the built app, at the widths it is used
 * at (`StepLine`, `stepMarks.css`). The oracle is the rule (DESIGN.md, Charts): every place's mark —
 * «now»'s ring, a restart's ring, the ring of a reset between two windows and the forecast's dot —
 * is a true circle at every width, pointed at as at rest; and on a window past its reset and on the
 * windows before the current one, the marks take the neutral ink their readings are drawn in. The
 * owner found the dot on hover flat: a restart's ring stretched over its fall, and a reset from 0 %
 * to 0 % an oval.
 *
 * The fixture (`quotaTable`) over «4 weeks»: «Alpha»'s live week holds the weeks before it, one of
 * them with a restart inside it, with now and its forecast; «Beta»'s first week before ends at 0 %,
 * so its reset falls from 0 % to 0 %; «Gamma»'s week is past its reset, its line muted.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { quotaTable } from '../fixtures/quotaTable.ts'
import { NOW, openPanel, pageAt, record, serve, serveQuota } from './analyticsPage.ts'
import { drawLined } from './drawnViews.ts'
import { test } from './test.ts'

/** How far a mark's width and height may differ and still be one circle: a pixel's rounding. */
const ROUND = 0.5

/** A window card's step line by its account and kind. */
const lineOf = (page: Page, name: string, kind: string) =>
  page.locator(`[data-account="${name}"] [data-window="${kind}"] [data-chart="steps"]`)

/** Opens the week's section of the page over «4 weeks», drawn as charts. */
async function openWeeks(page: Page, width: number) {
  await serve(page)
  await serveQuota(page, quotaTable(NOW))
  await page.setViewportSize({ width, height: 1000 })
  await openPanel(page, pageAt({ by: 'quota_week', period: 'weeks4' }))
  await expect(page.locator('[data-account]')).not.toHaveCount(0)
  await drawLined(page.locator('.chart-section').first())
  await page.evaluate(() => document.fonts.ready)
}

/**
 * Each place of a line, stood on with the keyboard's focus as a reader does, its mark painted: its
 * kind, whether it is a fall at a reset, its rendered box, its ring's or dot's colour, and the ink
 * of the readings it belongs to.
 */
async function placesOf(line: Locator) {
  const places = line.locator('[data-target]')
  const found = []
  for (const place of await places.all()) {
    await place.focus()
    await expect(place.locator('[data-mark="place"]')).toHaveCSS('opacity', '1')
    found.push(
      await place.evaluate((target: HTMLElement) => {
        const mark = target.querySelector<HTMLElement>('[data-mark="place"]')
        if (!mark) throw new Error('a place has its mark')
        const box = mark.getBoundingClientRect()
        const style = getComputedStyle(mark)
        return {
          kind: target.dataset.target ?? '',
          drop: target.dataset.drop !== undefined,
          width: box.width,
          height: box.height,
          ink: mark.dataset.shape === 'dot' ? style.backgroundColor : style.boxShadow,
        }
      }),
    )
  }
  return found
}

/** The colour a path of the line is drawn in. */
const strokeOf = (line: Locator, mark: string) =>
  line.locator(`[data-mark="${mark}"]`).evaluate((path) => getComputedStyle(path).stroke)

for (const width of [1440, 1024, 390])
  test(`at ${width}px every place’s mark is round, and muted on a window past its reset`, async ({
    page,
  }, info) => {
    await openWeeks(page, width)
    const alpha = lineOf(page, 'Alpha', 'week')
    const beta = lineOf(page, 'Beta', 'week')
    const gamma = lineOf(page, 'Gamma', 'week')
    const marks = {
      alpha: await placesOf(alpha),
      beta: await placesOf(beta),
      gamma: await placesOf(gamma),
    }
    await record(info, `quota marks ${width}`, marks)
    // «Alpha»: four falls at the resets of the weeks before, the restart inside one of them, now
    // and the forecast; «Beta»: four falls, the first from 0 % to 0 %; «Gamma»: its two falls.
    expect(marks.alpha.map(({ kind }) => kind).sort()).toEqual(
      ['now', 'reset', 'restart', 'restart', 'restart', 'restart', 'restart'].sort(),
    )
    expect(marks.beta.filter(({ drop }) => drop)).toHaveLength(4)
    expect(marks.gamma.filter(({ drop }) => drop)).toHaveLength(2)
    for (const [name, found] of Object.entries(marks))
      for (const [index, mark] of found.entries()) {
        expect(
          Math.abs(mark.width - mark.height),
          `${name} ${mark.kind} ${index} round`,
        ).toBeLessThan(ROUND)
        expect(
          mark.width,
          `${name} ${mark.kind} ${index} a dot across, pointed at`,
        ).toBeGreaterThan(8)
      }
    // The marks of the weeks before «Alpha»'s current one, and every mark of «Gamma»'s past week,
    // take the ink their readings are drawn in; «Alpha»'s now and forecast keep the line's hue.
    const earlier = await strokeOf(alpha, 'earlier')
    const current = await strokeOf(alpha, 'line')
    expect(earlier).not.toBe(current)
    for (const mark of marks.alpha.filter(({ kind }) => kind === 'restart'))
      expect(mark.ink, 'a mark of a week before').toContain(earlier)
    for (const mark of marks.alpha.filter(({ kind }) => kind !== 'restart'))
      expect(mark.ink, `the current week's ${mark.kind}`).toContain(current)
    const gammaInk = await strokeOf(gamma, 'line')
    expect(gammaInk).toBe(earlier)
    for (const mark of marks.gamma) expect(mark.ink, 'a mark of a past week').toContain(gammaInk)
  })
