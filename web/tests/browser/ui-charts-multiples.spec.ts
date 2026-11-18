/**
 * The small multiples in the browser, beside the other chart primitives on their harness page
 * (`ui-charts.spec.ts`), measured rather than looked at at a wide desktop, a laptop and a phone.
 */
import { expect } from '@playwright/test'

import { brokenWords } from './brokenWords.ts'
import { test } from './test.ts'

const WIDTHS = [1440, 1024, 390] as const

/**
 * The small multiples, measured: every chart on the shared scale is the same height and a column
 * is its period over the scale's top, which is written once; each name keeps one line however
 * long; and work with no task and unknown work stand apart with no chart. Their table holds the
 * same rows and says which day has no figure, and a long name in it wraps between its words,
 * never inside one.
 */
for (const width of WIDTHS) {
  test(`at ${width}px the small multiples read on one scale said once, each name on one line`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/tests/browser/harness.html?lang=en&surface=charts')
    const section = page.locator('[data-harness="multiples"]')
    await expect(section.locator('.multiple').first()).toBeVisible()
    await page.evaluate(() => document.fonts.ready)
    const seen = await section.evaluate((root) => {
      // This body is serialized and evaluated in the page, so a module-scope helper would not
      // be in scope here.
      // eslint-disable-next-line unicorn/consistent-function-scoping -- see above
      const height = (element: Element | null) => element?.getBoundingClientRect().height ?? 0
      return {
        text: root.textContent ?? '',
        scale: root.querySelector('.multiples-scale')?.textContent?.trim() ?? '',
        shared: [...root.querySelectorAll('.multiple')].map((one) => {
          const name = one.querySelector('.multiple-name')
          return {
            key: (one as HTMLElement).dataset.key ?? '',
            name: name?.textContent ?? '',
            nameHeight: height(name),
            lineHeight: Number.parseFloat(getComputedStyle(name ?? one).lineHeight),
            plot: height(one.querySelector('.multiple-plot')),
            // The height a column reaches at the scale's top: the plot above its floor's rule.
            field: height(one.querySelector('.multiple-period')),
            columns: [...one.querySelectorAll('.multiple-period')].map((period) =>
              height(period.querySelector('.multiple-column')),
            ),
          }
        }),
        apart: [...root.querySelectorAll('.multiple-rest')].map((one) => ({
          name: one.querySelector('.multiple-name')?.textContent ?? '',
          plots: one.querySelectorAll('.multiple-plot, .multiple-column').length,
        })),
      }
    })
    await testInfo.attach(`multiples-${width}`, {
      body: JSON.stringify(seen, null, 2),
      contentType: 'application/json',
    })

    // 240 minutes is the largest period on the scale; its round top is 300, said once.
    expect(seen.text.split('Every chart from 0 to')).toHaveLength(2)
    expect(seen.scale).toBe('Every chart from 0 to 5 h 00 min')
    expect(seen.shared.map((one) => one.key)).toEqual([
      'core',
      'web',
      'example-project-with-a-rather-long-repository-identifier',
      'docs',
      'other',
    ])
    const [first] = seen.shared
    for (const one of seen.shared) {
      expect(one.plot, `${one.key} on another scale`).toBeCloseTo(first?.plot ?? 0, 0)
      expect(one.nameHeight, `${one.key} name on more than one line`).toBeLessThanOrEqual(
        one.lineHeight + 1,
      )
    }
    expect(seen.shared[2]?.name).toBe('example-project-with-a-rather-long-repository-identifier')
    const field = first?.field ?? 0
    // core's 240 minutes and web's 60 stand at 240 and 60 of the 300 the scale reaches.
    expect(first?.columns[3]).toBeCloseTo(field * 0.8, 0)
    expect(seen.shared[1]?.columns[2]).toBeCloseTo(field * 0.2, 0)
    // The 600 minutes of work on no task stand apart and set nothing.
    expect(seen.apart).toEqual([
      { name: 'No task', plots: 0 },
      { name: 'Unknown', plots: 0 },
    ])

    const table = page.locator('[data-harness="multiples-table"] table')
    await expect(table.locator('tbody tr')).toHaveCount(7)
    const docs = table.locator('tbody tr').nth(3)
    await expect(docs.locator('th')).toHaveText('docs')
    await expect(docs.locator('td').nth(1)).toHaveText('—No figure')
    expect(await brokenWords(page, '[data-harness="multiples-table"] :is(th, td)')).toEqual([])
  })
}
