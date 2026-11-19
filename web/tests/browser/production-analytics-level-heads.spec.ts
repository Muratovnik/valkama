/**
 * The heading rows of the Analytics panel's levels, in the built app (`PanelLevel`). The oracle is
 * the rule (`DESIGN.md`, System rules): everything on a line of a heading row shares one centre
 * line — the heading, an icon-only control such as the menu at an account's name, a text button
 * such as «Name» beside it, a switch at the row's end. Aligned by baselines, the menu, which has
 * no baseline of its own, stood 3px above «Name».
 *
 * Every heading row (`data-level-head`) of the quota's week and of a dimension's section is
 * measured at 1440, 1024 and 390 pixels: the controls (by role) that stand on its heading's line,
 * and their centres against the heading's. An account with no name of its own, «Name» beside its
 * menu, is the case reported. Each run attaches what it measured.
 */
import { expect } from '@playwright/test'
import type { Locator } from '@playwright/test'

import { NIGHT_NAME } from '../fixtures/quota.ts'
import { openPanel, pageAt, record, serve } from './analyticsPage.ts'
import { test } from './test.ts'

/** How far two centres may stand apart and still be one line: the layout's rounding. */
const NEAR = 0.5

/**
 * The controls on the line of the night account's heading at each width: its menu and «Name» on
 * a wide panel, the menu alone where a phone's wraps «Name» under the name.
 */
const NIGHT_ON_LINE: Record<number, number> = { 1440: 2, 1024: 2, 390: 1 }

/**
 * Each heading row: the account its level is, where the level is an account, its heading's centre and the
 * centres of the controls that stand on the heading's line.
 */
const rowsOf = (where: Locator) =>
  where.locator('[data-level-head]').evaluateAll((heads) =>
    heads
      .filter((head) => head.checkVisibility())
      .map((head) => {
        const heading = head.querySelector(':is(h1, h2, h3, h4, h5, h6)')?.getBoundingClientRect()
        const top = heading?.top ?? Number.NaN
        const bottom = heading?.bottom ?? Number.NaN
        const onLine = [...head.querySelectorAll('button, [role="radio"], [role="combobox"]')]
          .filter((control) => control.checkVisibility())
          .map((control) => control.getBoundingClientRect())
          .filter((box) => box.bottom > top && box.top < bottom)
        return {
          account: head.closest<HTMLElement>('[data-level]')?.dataset.account ?? null,
          text: (head.textContent ?? '').trim().slice(0, 40),
          heading: (top + bottom) / 2,
          controls: onLine.map((box) => box.top + box.height / 2),
        }
      }),
  )

for (const width of [1440, 1024, 390])
  test(`every heading row centres its heading and its controls on one line at ${width} px`, async ({
    page,
  }, info) => {
    await serve(page)
    await page.setViewportSize({ width, height: 1000 })
    const seen: Record<string, unknown> = {}

    const quota = await openPanel(page, pageAt({ by: 'quota_week' }))
    await expect(quota.locator(`[data-account="${NIGHT_NAME}"]`)).toBeVisible()
    await page.evaluate(() => document.fonts.ready)
    const quotaRows = await rowsOf(quota.locator('.analytics-panel'))
    seen.quota = quotaRows
    // The account with no name of its own: «Name» beside its menu, the case reported.
    const night = quotaRows.filter((row) => row.account === NIGHT_NAME)
    expect(night, 'the night account’s heading row').toHaveLength(1)
    expect(night[0]?.controls, 'its controls on the heading’s line').toHaveLength(
      NIGHT_ON_LINE[width] ?? 0,
    )

    const dimension = await openPanel(page, pageAt({ by: 'account' }))
    await expect(dimension.locator('.spending-days')).toBeVisible()
    const dimensionRows = await rowsOf(dimension.locator('.analytics-panel'))
    seen.dimension = dimensionRows
    await record(info, `level-heads-${width}`, seen)

    for (const rows of [quotaRows, dimensionRows]) {
      // Rows with a control on the heading's line: every account's menu, every switch.
      const mixed = rows.filter((row) => row.controls.length)
      expect(mixed.length, 'heading rows with a control beside the heading').toBeGreaterThan(0)
      for (const row of mixed)
        for (const control of row.controls)
          expect(
            Math.abs(control - row.heading),
            `${row.text}: on the heading's centre`,
          ).toBeLessThan(NEAR)
    }
  })
