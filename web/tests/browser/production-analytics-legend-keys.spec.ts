/**
 * The keys of the period chart's legend, in the real app, in English and in Russian, on a phone,
 * a narrow window and a wide one. The oracle is the owner's rule for the legend: its lines step
 * 24 pixels, every key that acts is a 24-pixel target whether it is a link or a button, and every
 * line is one height.
 *
 * Three legends hold every kind of key there is: the task section's, whose tasks are links and
 * whose «No task» is a button; the model section's, whose models are buttons; and the overview's,
 * with the folded «Other» and the period before, which only show. «Unknown» only shows too. A
 * button took a control's 40 pixels, so the line holding «No task» stood 40 pixels among lines
 * of 17, while a link was a 17-pixel target 4 pixels from the next line's. In each legend:
 * - every key that acts can be pressed across at least 24 pixels, up and down and across;
 * - no two keys that act share a pixel a pointer could press;
 * - every line is as tall as the others, and the lines step at least 24 pixels;
 * - the words of the keys on one line stand at one height;
 * - a key that does nothing is no control and shows no pointer's hand, and a press on it leaves
 *   the page where it was, so nothing promises a press it does not answer.
 * Each run prints what it measured.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { openReport, pageAt, record, serve } from './analyticsPage.ts'
import { frames } from './frames.ts'
import { WORLD as OVERVIEW_WORLD } from './overviewPage.ts'
import { SECTION_WORLD } from './served/analyticsLegendKeys.ts'
import { test } from './test.ts'
const LEGENDS = [
  { name: "the task section's", world: SECTION_WORLD, address: pageAt({ by: 'work_item' }) },
  { name: "the model section's", world: SECTION_WORLD, address: pageAt({ by: 'model' }) },
  { name: "the overview's", world: OVERVIEW_WORLD, address: pageAt() },
] as const

const WIDTHS = [390, 1024, 1440]

/** What the choice of a chart over its table is called, in each language. */
const CHART = { en: 'Chart', ru: 'График' }

/**
 * The day chart's legend keys: for each, whether it acts, the box a pointer can press (its border
 * box and any `::after` reaching past it), the top of its words, the line it stands on (its
 * entry's box), its cursor, and whether it takes focus. To the hundredth of a pixel.
 */
async function legendKeys(page: Page) {
  return page.evaluate(() => {
    // This body is serialized and evaluated in the page, so a module-scope
    // helper would not be in scope here.
    // eslint-disable-next-line unicorn/consistent-function-scoping -- see above
    const hundredth = (figure: number) => Math.round(figure * 100) / 100
    return [
      ...document.querySelectorAll<HTMLElement>(
        '.spending-days [data-hint-list="legend"] :is([data-series], [data-mark])',
      ),
    ].map((key) => {
      const box = key.getBoundingClientRect()
      const after = getComputedStyle(key, '::after')
      const reach = (side: string) =>
        after.content === 'none' ? 0 : Math.max(0, -Number.parseFloat(side) || 0)
      const words = key.querySelector('[data-part="name"]') ?? key
      const range = document.createRange()
      range.selectNodeContents(words)
      const said = range.getBoundingClientRect()
      // The line it stands on: its item of the legend's list.
      const entry = (key.closest('[data-hint-list="legend"] li') ?? key).getBoundingClientRect()
      return {
        text: words.textContent.trim(),
        acts: key.matches('a[href], button'),
        press: {
          top: hundredth(box.top - reach(after.top)),
          bottom: hundredth(box.bottom + reach(after.bottom)),
          left: hundredth(box.left - reach(after.left)),
          right: hundredth(box.right + reach(after.right)),
        },
        words: hundredth(said.top),
        line: { top: hundredth(entry.top), height: hundredth(entry.height) },
        cursor: getComputedStyle(key).cursor,
        focusable: key.tabIndex >= 0 || key.hasAttribute('role'),
      }
    })
  })
}

type Key = Awaited<ReturnType<typeof legendKeys>>[number]

/** The keys grouped by the line they stand on, top to bottom. */
function linesOf(keys: readonly Key[]) {
  const lines = new Map<number, Key[]>()
  for (const key of keys) {
    const at = Math.round(key.line.top)
    lines.set(at, [...(lines.get(at) ?? []), key])
  }
  return [...lines.entries()].toSorted(([a], [b]) => a - b).map(([, found]) => found)
}

/** How far two pressable boxes share ground, in pixels across and up and down. */
const shared = (a: Key['press'], b: Key['press']) => ({
  across: Math.min(a.right, b.right) - Math.max(a.left, b.left),
  down: Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top),
})

for (const legend of LEGENDS)
  for (const locale of ['en', 'ru'] as const)
    for (const width of WIDTHS)
      test(`in ${locale} at ${width}, ${legend.name} legend steps 24 pixels a line and every key that acts is a 24-pixel target`, async ({
        page,
      }, info) => {
        await page.addInitScript((chosen) => localStorage.setItem('valkama-locale', chosen), locale)
        await serve(page, legend.world)
        await openReport(page, width, legend.address)
        // A panel too narrow for the charts opens each as its table; it is chosen back.
        const tables = page.getByRole('radio', { name: CHART[locale], checked: false })
        while ((await tables.count()) > 0) await tables.first().click()
        const chartLegend = page.locator('.spending-days [data-hint-list="legend"]')
        await expect(chartLegend).toBeVisible()
        await page.evaluate(() => document.fonts.ready)
        await frames(chartLegend)

        const keys = await legendKeys(page)
        const lines = linesOf(keys)
        await record(info, `legend keys ${legend.name} ${locale} ${width}`, { lines })
        const acting = keys.filter((key) => key.acts)
        const inert = keys.filter((key) => !key.acts)
        // The run holds what it is for: keys that act, and keys that only show.
        expect(acting.length, 'keys that act').toBeGreaterThan(1)
        expect(inert.length, 'keys that only show').toBeGreaterThan(0)

        for (const key of acting) {
          expect(key.press.bottom - key.press.top, `${key.text}: height`).toBeGreaterThanOrEqual(24)
          expect(key.press.right - key.press.left, `${key.text}: width`).toBeGreaterThanOrEqual(24)
        }
        const overlaps = acting.flatMap((one, index) =>
          acting.slice(index + 1).flatMap((other) => {
            const { across, down } = shared(one.press, other.press)
            return across > 0.5 && down > 0.5 ? [`${one.text} / ${other.text}`] : []
          }),
        )
        expect(overlaps, 'keys whose pressable boxes overlap').toEqual([])

        const heights = lines.map((line) => Math.max(...line.map((key) => key.line.height)))
        expect(
          Math.max(...heights) - Math.min(...heights),
          `line heights ${heights.join(', ')}`,
        ).toBeLessThanOrEqual(0.5)
        const tops = lines.map((line) => line[0]?.line.top ?? 0)
        for (const [index, top] of tops.slice(1).entries())
          expect(top - (tops[index] ?? 0), `step to line ${index + 2}`).toBeGreaterThanOrEqual(
            23.99,
          )
        const uneven = lines.filter((line) => {
          const said = line.map((key) => key.words)
          return Math.max(...said) - Math.min(...said) > 0.5
        })
        expect(uneven, 'lines whose words stand at different heights').toEqual([])

        const address = page.url()
        for (const key of inert) {
          expect(key.focusable, `${key.text}: a control`).toBe(false)
          expect(key.cursor, `${key.text}: cursor`).not.toBe('pointer')
          await page.mouse.click(
            (key.press.left + key.press.right) / 2,
            (key.press.top + key.press.bottom) / 2,
          )
          // Two frames, in which a press that led somewhere would have changed the address.
          await frames(chartLegend)
          expect(page.url(), `${key.text}: pressed`).toBe(address)
        }
      })
