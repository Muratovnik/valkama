/**
 * Every place of the quota's step lines — a restart, a reset between two windows, «now», the
 * forecast — found by the real pointer at the middle of its box on a period whose readings stand
 * on every pixel, in the built app at 1440, 1024 and 390 pixels (`StepLine`, `aimAt`). The oracle
 * is the rule (`DESIGN.md`, the step line): within a mark's reach of the pointer a place's mark
 * wins over any reading's, the nearest of several; a place's box has its middle where the pointer
 * finds it; and of two places within a mark's reach of each other the pointer finds the nearer,
 * whose hint says the other's words too. Two marks within a pixel of each other no pointer tells
 * apart: there the place found may be either, and its hint says both.
 *
 * On «4 weeks» before that rule, a reset between two windows on the pixel of the reading before
 * it was never found, and the middle of «now»'s box, 12px past its ring, found the forecast.
 *
 * The fixture (`quotaDense`): «Work»'s five hours hold eight windows before the current one and
 * restart twice, its week four and twice; every reset stands beside a reading, and «now» on the
 * latest. Each run attaches what it measured.
 */
import { expect } from '@playwright/test'
import type { Locator } from '@playwright/test'

import { quotaDense } from '../fixtures/quotaDense.ts'
import { NOW, openPanel, pageAt, record, serve, serveQuota } from './analyticsPage.ts'
import { test } from './test.ts'

/**
 * The window of «Work» each section shows the dense line of, and its places by the fixture: a
 * reset at the end of each window before the current one, two restarts, «now» and the forecast.
 */
const WORK_LINE = {
  quota_five_hour: { kind: 'five_hour', places: 8 + 2 + 2 },
  quota_week: { kind: 'week', places: 4 + 2 + 2 },
} as const

/** How near two marks stand for no pointer to tell them apart: a pixel, the pointer's rounding. */
const PIXEL = 1

/**
 * A place as its stop says it — its name, its figure and each line under them — which its hint
 * draws as a grid, the name and the figure in columns of their own.
 */
function wordsOf(said: string) {
  const [head = '', ...notes] = said.split('\n')
  const cut = head.indexOf(': ')
  return [...(cut === -1 ? [head] : [head.slice(0, cut), head.slice(cut + 2)]), ...notes]
}

/** Each place of a line: its stop, its kind, its words, its box's middle and its mark's. */
const placesOf = (line: Locator) =>
  line.locator('[data-target]').evaluateAll((places) =>
    places.map((place) => {
      const box = place.getBoundingClientRect()
      const mark = place.querySelector('[data-mark="place"]')?.getBoundingClientRect()
      return {
        stop: (place as HTMLElement).dataset.stop ?? '',
        kind: (place as HTMLElement).dataset.target ?? '',
        said: (place as HTMLElement).dataset.tooltip ?? '',
        x: box.left + box.width / 2,
        y: box.top + box.height / 2,
        mark: mark ? mark.left + mark.width / 2 : Number.NaN,
      }
    }),
  )

/** The stop whose mark the line paints, a reading's or a place's, or null where it paints none. */
const paintedOf = (line: Locator) =>
  line.evaluate((figure) => {
    const painted = [...figure.querySelectorAll('[data-mark="place"], [data-mark="reading"]')].find(
      (mark) => getComputedStyle(mark).opacity === '1',
    )
    return painted?.closest<HTMLElement>('[data-stop]')?.dataset.stop ?? null
  })

for (const width of [1440, 1024, 390])
  for (const section of ['quota_five_hour', 'quota_week'] as const)
    test(`the pointer finds every place of a dense line at the middle of its box: ${section} at ${width} px`, async ({
      page,
    }, info) => {
      await serve(page)
      await serveQuota(page, quotaDense(NOW))
      await page.setViewportSize({ width, height: 1000 })
      await openPanel(page, pageAt({ by: section, period: 'weeks4' }))
      const panel = page.locator('.quota-panel')
      await panel.getByRole('radio', { name: 'Chart' }).check()
      await expect(
        panel.locator(
          `[data-account="Work"] [data-window="${WORK_LINE[section].kind}"] [data-target]`,
        ),
      ).toHaveCount(WORK_LINE[section].places)
      const lines = panel.locator('[data-chart="steps"]')
      const hint = page.locator('.tooltip-hint')
      const seen: unknown[] = []
      for (const line of await lines.all()) {
        await line.scrollIntoViewIfNeeded()
        const places = await placesOf(line)
        for (const place of places) {
          // Two marks within a pixel of each other: either may be found, and says both.
          const twins = places.filter(
            (other) => other !== place && Math.abs(other.mark - place.mark) <= PIXEL,
          )
          const found = [place.stop, ...twins.map(({ stop }) => stop)]
          await page.mouse.move(place.x, place.y)
          // Its own mark, or a twin's where it has one.
          await expect
            .poll(
              async () => found.includes((await paintedOf(line)) ?? ''),
              `${place.kind} ${place.stop}: the mark painted is its own`,
            )
            .toBe(true)
          seen.push({
            ...place,
            said: undefined,
            painted: await paintedOf(line),
            twins: found.slice(1),
          })
          await expect(hint).toHaveCount(1)
          for (const words of wordsOf(place.said))
            await expect(hint, `${place.kind} ${place.stop}: its words`).toContainText(words)
        }
        await page.mouse.move(0, 0)
      }
      expect(seen.length, 'places pointed at').toBeGreaterThanOrEqual(WORK_LINE[section].places)
      await record(info, `quota-reach-${section}-${width}`, seen)
    })
