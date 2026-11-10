/**
 * A menu of priorities, kinds or states draws each value as its button draws the chosen one:
 * the glyph, the word, and for a priority what it means; a state with its dot.
 *
 * The card's priority button showed its glyph and the list under it plain words; its state
 * chip a dot and the list nothing; the new task's kind and priority were words in both; the
 * filter's menu named a kind in its colour and nothing else. Measured in the built
 * application: which rows draw a glyph or a dot, and that the chosen value's glyph in the
 * button is the same drawing as its row's.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { planningWorkItemEntity } from '@/shared/api/platformPlanningRefs.ts'
import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { installBackend } from './backend.ts'
import { openFacet, openSpace } from './filterPage.ts'
import { projectScope, workItemRef } from './planningFixtures.ts'
import { test } from './test.ts'

const BOARD = serializePlatformRoute({ module_id: 'planning', scope: projectScope })
const CARD = serializePlatformRoute({
  module_id: 'planning',
  scope: projectScope,
  entity: planningWorkItemEntity(workItemRef),
})

/** The priorities most pressing first; medium is the norm and has no glyph. */
const PRIORITIES = [
  { word: 'Urgent', glyph: true },
  { word: 'High', glyph: true },
  { word: 'Medium', glyph: false },
  { word: 'Low', glyph: true },
]
/** The kinds in the model's order; a plain task has no glyph. */
const KINDS = [
  { word: 'Bug', glyph: true },
  { word: 'Epic', glyph: true },
  { word: 'Improvement', glyph: true },
  { word: 'Task', glyph: false },
]

interface Drawn {
  /** The state's dot, by the tone it is drawn in. */
  dot: string | null
  /** The glyph's drawing, so a row's and a button's can be compared. */
  glyph: string | null
  word: string
}

/** What each box draws: its glyph, its state dot and its word. */
function drawn(boxes: Locator): Promise<Drawn[]> {
  return boxes.evaluateAll((nodes) =>
    nodes.map((node) => {
      const glyph = node.querySelector('.facet-glyph')
      const state = node.querySelector('.semantic-state')
      const word = node.querySelector('.facet-word, .state-label, .option-text, .choice-title')
      return {
        dot: (state?.querySelector('.state-dot') && (state as HTMLElement).dataset.tone) || null,
        glyph: glyph ? glyph.innerHTML : null,
        word: (word?.textContent ?? '').trim(),
      }
    }),
  )
}

/** The rows say the expected words, a glyph on exactly the values that have one. */
function expectGlyphs(rows: Drawn[], expected: typeof PRIORITIES) {
  expect(rows.map((row) => row.word)).toEqual(expected.map((value) => value.word))
  expect(rows.map((row) => row.glyph !== null)).toEqual(expected.map((value) => value.glyph))
}

async function openCard(page: Page) {
  await page.setViewportSize({ width: 1280, height: 900 })
  await installBackend(page, { card: (read) => ({ ...read, priority: 'high' }) })
  await page.goto(CARD)
  const drawer = page.locator('.drawer')
  await expect(drawer.locator('.card-facts .card-row-value')).toBeVisible()
  return drawer
}

test('the card’s priority menu draws each priority as its button draws the chosen one', async ({
  page,
}) => {
  const drawer = await openCard(page)
  const button = drawer.locator('.card-priority .choice-trigger')
  const [chosen] = await drawn(button)
  expect(chosen.word).toBe('High')
  await button.click()
  const options = page.getByRole('option')
  const rows = await drawn(options)
  expectGlyphs(rows, PRIORITIES)
  // The button's glyph is the same drawing as the chosen row's.
  expect(rows[1].glyph).toBe(chosen.glyph)
  // What each one means stays under it.
  await expect(options.nth(0).locator('.choice-note')).not.toBeEmpty()
})

test('the card’s state menu draws each state with its dot, as the chip draws the state', async ({
  page,
}) => {
  const drawer = await openCard(page)
  const chip = drawer.locator('.card-state .choice-trigger')
  const [here] = await drawn(chip)
  await chip.click()
  const rows = await drawn(page.getByRole('option'))
  expect(rows.length).toBeGreaterThan(1)
  for (const row of rows) expect(row.dot, row.word).not.toBeNull()
  expect(rows[0]).toEqual(here)
})

test('the new task’s kind and priority draw their values as the card does', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await installBackend(page)
  await page.goto(BOARD)
  await page.getByRole('button', { name: 'New work item' }).click()
  const dialog = page.getByRole('dialog', { name: 'New work' })
  await expect(dialog).toHaveCSS('transform', 'none')
  const [kind, priority] = await dialog.locator('.choice-trigger').all()

  await kind.click()
  expectGlyphs(await drawn(page.getByRole('option')), KINDS)
  await page.getByRole('option', { name: /^Bug/u }).click()
  const [bug] = await drawn(kind)
  expect(bug.word).toBe('Bug')
  await kind.click()
  const [bugRow] = await drawn(page.getByRole('option'))
  expect(bugRow.glyph).toBe(bug.glyph)
  await page.keyboard.press('Escape')

  await priority.click()
  expectGlyphs(await drawn(page.getByRole('option')), PRIORITIES)
  await page.getByRole('option', { name: /^Urgent/u }).click()
  const [urgent] = await drawn(priority)
  expect(urgent.word).toBe('Urgent')
  expect(urgent.glyph).not.toBeNull()
})

test('the filter’s menu draws kinds, priorities and states as the card does', async ({ page }) => {
  await openSpace(page)
  const menuRows = () => drawn(page.locator('.filter-menu .option-row:not(.option-back)'))
  await openFacet(page, 'Kind')
  expectGlyphs(await menuRows(), KINDS)
  await page.getByRole('option', { name: 'Back to the facets' }).click()
  await openFacet(page, 'Priority')
  expectGlyphs(await menuRows(), PRIORITIES)
  await page.getByRole('option', { name: 'Back to the facets' }).click()
  await openFacet(page, 'State')
  const states = await menuRows()
  expect(states.length).toBeGreaterThan(1)
  for (const row of states) expect(row.dot, row.word).not.toBeNull()
})

const LONG_STATE = 'Waiting for the release owner to sign off the installer build and its notes'

test('a long state in the card’s state menu ends in an ellipsis inside its row, which says it whole', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await installBackend(page, {
    card: (read) => ({ ...read, state: { ...(read.state as object), name: LONG_STATE } }),
  })
  await page.goto(CARD)
  const drawer = page.locator('.drawer')
  await expect(drawer.locator('.card-facts .card-row-value')).toBeVisible()
  await drawer.locator('.card-state .choice-trigger').click()
  const word = page.getByRole('option').locator('.state-label', { hasText: LONG_STATE })
  await expect(word).toBeVisible()
  // The state the menu draws is cut by its own one-line word, at the row's edge and not past it.
  const drawn = await word.evaluate((node) => {
    const row = node.closest('[role="option"]')?.getBoundingClientRect()
    return {
      cut: node.scrollWidth > node.clientWidth,
      ending: getComputedStyle(node).textOverflow,
      inside: row !== undefined && node.getBoundingClientRect().right <= row.right + 0.5,
    }
  })
  expect(drawn).toEqual({ cut: true, ending: 'ellipsis', inside: true })
  await word.hover()
  await expect(page.getByRole('tooltip')).toContainText(LONG_STATE)
})
