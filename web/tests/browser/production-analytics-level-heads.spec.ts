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
 * menu, is the case reported. Its menu and «Name» are one unit (`DESIGN.md`, the quota's accounts):
 * on the name's line where both fit beside it, and on the next line together where they do not,
 * as a phone's 390 pixels leave the night account's name; as two items of the row, «Name» alone
 * wrapped there, 40px under the menu. Each run attaches what it measured.
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
 * a wide panel, neither where a phone's has no room for both beside the name.
 */
const NIGHT_ON_LINE: Record<number, number> = { 1440: 2, 1024: 2, 390: 0 }

/**
 * The night account's menu and «Name», by the hooks of its head (`QuotaAccount`): the centre of
 * each, the top of each, and the foot of its name.
 */
async function nightControls(where: Locator) {
  const account = where.locator(`[data-account="${NIGHT_NAME}"]`)
  const menu = account.locator('[data-account-head="menu"]').getByRole('button')
  await expect(menu, 'the night account’s menu').toHaveCount(1)
  const nameIt = account.locator('[data-account-head="name-it"]')
  await expect(nameIt, 'its «Name»').toHaveCount(1)
  const box = async (control: Locator) => {
    const found = await control.boundingBox()
    if (!found) throw new Error('a control of the night account stands nowhere')
    return { top: found.y, centre: found.y + found.height / 2 }
  }
  const name = await account.locator('[data-account-head="name"]').boundingBox()
  return {
    menu: await box(menu),
    nameIt: await box(nameIt),
    nameFoot: name ? name.y + name.height : Number.NaN,
  }
}

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

/** Where a part of an account's head stands: its left edge and its centre line. */
async function placeOf(part: Locator) {
  const found = await part.boundingBox()
  if (!found) throw new Error('a part of the account’s head stands nowhere')
  return { left: found.x, centre: found.y + found.height / 2 }
}

// The field that renames the account takes the name's place (`DESIGN.md`, the quota's accounts):
// it starts on the edge the name stood on, and the menu stays on its line. Laid out at a name's
// width, a phone's field wrapped under the unseen name, 12px past that edge, the menu 40px above it.
for (const width of [1440, 1024, 390])
  test(`the rename field stands in the name's place with the menu on its line at ${width} px`, async ({
    page,
  }, info) => {
    await serve(page)
    await page.setViewportSize({ width, height: 1000 })
    const quota = await openPanel(page, pageAt({ by: 'quota_week' }))
    const account = quota.locator(`[data-account="${NIGHT_NAME}"]`)
    await expect(account).toBeVisible()
    await page.evaluate(() => document.fonts.ready)
    const name = await placeOf(account.locator('[data-account-head="name"]'))
    await account.locator('[data-account-head="name-it"]').click()
    const field = account.locator('[data-account-head="field"]')
    await expect(field.getByRole('textbox'), 'the field that renames it').toBeFocused()
    const menu = await placeOf(account.locator('[data-account-head="menu"]').getByRole('button'))
    const seen = { name: name.left, field: await placeOf(field), menu: menu.centre }
    await record(info, `rename-field-${width}`, seen)
    expect(Math.abs(seen.field.left - seen.name), 'the field on the name’s edge').toBeLessThan(NEAR)
    expect(Math.abs(seen.menu - seen.field.centre), 'the menu on the field’s line').toBeLessThan(
      NEAR,
    )
  })

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
    // Its menu and «Name» are one unit: on one centre line, the name's or the next one together.
    const controls = await nightControls(quota)
    seen.night = controls
    expect(
      Math.abs(controls.menu.centre - controls.nameIt.centre),
      'the menu and «Name» on one centre line',
    ).toBeLessThan(NEAR)
    // Under the name where neither stands on its line, on the name's line where both do.
    const wrapped = NIGHT_ON_LINE[width] === 0
    for (const top of [controls.menu.top, controls.nameIt.top])
      expect(top >= controls.nameFoot, 'a control under the name').toBe(wrapped)

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
