/**
 * Cards of other spaces in the list grouped by goal, at the list's widths: a desktop's,
 * the list's middle fit and a phone's.
 *
 * A card of another space, which names this space's project, has its parent in its own
 * space, so the tree gives it no goal here. It stands in a group of its space, one a
 * space, after this space's rows, named as the board's lane and the graph's frame of that
 * space are named, «Space ALPHA · Alpha»; its cards stand under it as a list. The group
 * folds from its row and opens no card. «From another space» negated keeps every such
 * card out, and with them their groups.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { installBackend } from './backend.ts'
import { boardRoute, lane } from './boardPage.ts'
import { drawnOf, rowOf } from './listTreePage.ts'
import { brief, identity, serveSpace, stateOf, stillFrames } from './longSpace.ts'
import { test } from './test.ts'

const WIDTHS = [
  { width: 1280, height: 900 },
  { width: 1024, height: 800 },
  { width: 390, height: 844 },
] as const

/** Another space's card, numbered past this space's and named by its own space's key. */
function elsewhere(number: number, space: { key: string; name: string }, extra: object = {}) {
  return brief(number, stateOf(1), {
    reference: `${space.key}-${number}`,
    other_space: space,
    ...extra,
  })
}

const ALPHA = { key: 'ALPHA', name: 'Alpha' }
const BETA = { key: 'BETA', name: 'Beta' }

/** This space's goal with two tasks and a task under no goal; three cards of two other spaces. */
function spacesSpace() {
  const goal = brief(1, stateOf(1), { kind: 'goal' })
  return [
    goal,
    brief(2, stateOf(1), { parent_id: identity(1) }),
    brief(3, stateOf(2), { parent_id: identity(1) }),
    brief(4, stateOf(1)),
    elsewhere(50, ALPHA, { kind: 'goal' }),
    // Its parent is a card of its own space, which this read does not hold.
    elsewhere(51, ALPHA, { parent_id: identity(49) }),
    elsewhere(60, BETA),
  ]
}

const ALPHA_GROUP = 'group:space:ALPHA'
const BETA_GROUP = 'group:space:BETA'

async function open(page: Page, size: (typeof WIDTHS)[number], state: Record<string, unknown>) {
  await page.setViewportSize({ width: size.width, height: size.height })
  await installBackend(page)
  await serveSpace(page, spacesSpace())
  await page.goto(boardRoute({ view: 'list', group: 'goal', sort: 'reference', ...state }))
  await expect(drawnOf(page).first()).toBeVisible()
  await stillFrames(page)
}

/** The rows in the tree's place, in order, each with its level. */
const shown = (page: Page) =>
  drawnOf(page)
    .and(page.locator(':not(.list-row-held)'))
    .evaluateAll((rows) =>
      rows.map((row) => `${row.dataset.reference ?? ''}:${row.getAttribute('aria-level') ?? ''}`),
    )

for (const size of WIDTHS) {
  test(`another space's cards stand in its group, last, at ${size.width}px`, async ({ page }) => {
    await open(page, size, {})
    expect(await shown(page)).toEqual([
      'MAIN-1:1',
      'MAIN-2:2',
      'MAIN-3:2',
      'MAIN-4:1',
      `${ALPHA_GROUP}:1`,
      'ALPHA-50:2',
      'ALPHA-51:2',
      `${BETA_GROUP}:1`,
      'BETA-60:2',
    ])
    const group = rowOf(page, ALPHA_GROUP)
    await expect(group).toHaveAccessibleName('Space ALPHA · Alpha')
    await expect(rowOf(page, BETA_GROUP)).toHaveAccessibleName('Space BETA · Beta')
    // Another space's goal holds nothing here.
    await expect(rowOf(page, 'ALPHA-50')).not.toHaveAttribute('aria-expanded')

    // A press on the group's row folds it and opens no card.
    await group
      .locator('td')
      .first()
      .click({ position: { x: 200, y: 8 } })
    await expect(group).toHaveAttribute('aria-expanded', 'false')
    await expect(rowOf(page, 'ALPHA-50')).toHaveCount(0)
    await expect(page.locator('.drawer')).toHaveCount(0)
    await expect(group).toBeFocused()
  })

  test(`«From another space» negated takes the groups away at ${size.width}px`, async ({
    page,
  }) => {
    await open(page, size, { elsewhere: '%-other' })
    expect(await shown(page)).toEqual(['MAIN-1:1', 'MAIN-2:2', 'MAIN-3:2', 'MAIN-4:1'])
    await expect(rowOf(page, ALPHA_GROUP)).toHaveCount(0)
  })
}

test("the group is named as the board's lane of that space is", async ({ page }) => {
  await open(page, WIDTHS[0], {})
  const name = await rowOf(page, ALPHA_GROUP).getAttribute('aria-labelledby')
  const words = await page.locator(`[id="${name ?? ''}"]`).textContent()
  await page.goto(boardRoute({ view: 'kanban', group: 'goal' }))
  await expect(lane(page, words ?? '')).toBeVisible()
})
