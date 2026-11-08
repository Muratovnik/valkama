/**
 * Labels combine as the reader says: «all» narrows with each label, «any» lets through work
 * that carries one of them. Every view reads the same answer, the chips say which it is, the
 * address keeps it only when it is «any», and Reset takes it out.
 */
import AxeBuilder from '@axe-core/playwright'
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { installDiscussionBackend } from './discussionBackend.ts'
import {
  addressState,
  allOf,
  anyOf,
  chips,
  field,
  labelledSpace,
  menu,
  menuLabels,
  openFacet,
  openSpace,
  shownTiles,
  words,
} from './filterPage.ts'
import { projectScope } from './planningFixtures.ts'
import { test } from './test.ts'

const pick = (page: Page, label: string) =>
  page.getByRole('option', { name: label, exact: true }).click()

/** The row the field names as active, the one a screen reader is told of. */
async function active(page: Page) {
  const id = await field(page).getAttribute('aria-activedescendant')
  return page.locator(`[id="${id}"]`)
}

/** ↓ from the field to the labels' row, into it, and on until the highlight stands on «all». */
async function walkToChoice(page: Page) {
  for (let step = 0; step < 10; step += 1) {
    await page.keyboard.press('ArrowDown')
    const row = await active(page)
    const text = await row.textContent()
    if (text?.trim() === 'Label') break
  }
  await page.keyboard.press('Enter')
  for (let step = 0; step < 40; step += 1) {
    await page.keyboard.press('ArrowDown')
    const row = await active(page)
    if ((await row.getAttribute('aria-label')) === 'Labels: all of those picked') return
  }
  throw new Error('the arrows never reach the choice')
}

/** The board with `ui` and `board` picked from the menu, which stays open. */
async function bothPicked(page: Page, width = 1440) {
  await openSpace(page, { width })
  await expect(page.locator('.work-item-tile').first()).toBeVisible()
  await openFacet(page, 'Label')
  await pick(page, 'ui')
  await pick(page, 'board')
  await expect(chips(page)).toHaveText(['Label: ui', 'Label: board'])
}

test('all by default: each label narrows, and the chips say so', async ({ page }) => {
  await bothPicked(page)
  await expect(allOf(page)).toHaveAttribute('aria-selected', 'true')
  await expect(anyOf(page)).toHaveAttribute('aria-selected', 'false')
  await expect.poll(() => shownTiles(page)).toEqual(['MAIN-402'])
  await expect(words(page)).toHaveText(['and'])
  await expect(page.locator('.workspace-figures')).toContainText('1 of')
  await expect.poll(() => addressState(page)).toEqual({ view: 'kanban', labels: 'ui,board' })
})

test('any: one of them will do, the chips say so, and the counts follow', async ({ page }) => {
  await bothPicked(page)
  await anyOf(page).click()
  await expect(anyOf(page)).toHaveAttribute('aria-selected', 'true')
  await expect(allOf(page)).toHaveAttribute('aria-selected', 'false')
  await expect.poll(() => shownTiles(page)).toEqual(['MAIN-402', 'MAIN-403', 'MAIN-404'])
  await expect(words(page)).toHaveText(['or'])
  await expect(page.locator('.workspace-figures')).toContainText('3 of')
  // Every label is still offered, in the same order, in either reading.
  expect(await menuLabels(page)).toEqual(['+board', '+ui', 'api'])
  // The chip's name stays what it was, and the word is read with it.
  await expect(chips(page).last()).toHaveAccessibleDescription('or')
  await expect(field(page)).toBeFocused()

  await allOf(page).click()
  await expect.poll(() => shownTiles(page)).toEqual(['MAIN-402'])
  await expect(words(page)).toHaveText(['and'])
})

test('one label needs no word, and taking a chip out keeps the reading', async ({ page }) => {
  await bothPicked(page)
  await anyOf(page).click()
  await chips(page).last().click()
  await expect(chips(page)).toHaveText(['Label: ui'])
  await expect(words(page)).toHaveCount(0)
  await expect.poll(() => shownTiles(page)).toEqual(['MAIN-402', 'MAIN-403'])
  await openFacet(page, 'Label')
  await expect(anyOf(page)).toHaveAttribute('aria-selected', 'true')
})

test('the address holds any only, a reload keeps it, and an old link reads as all', async ({
  page,
}) => {
  await bothPicked(page)
  await anyOf(page).click()
  await expect.poll(() => addressState(page)).toEqual({ view: 'kanban', labels: '%any,ui,board' })
  await page.reload()
  await expect(page.locator('.work-item-tile').first()).toBeVisible()
  await expect.poll(() => shownTiles(page)).toEqual(['MAIN-402', 'MAIN-403', 'MAIN-404'])
  await expect(words(page)).toHaveText(['or'])

  await openSpace(page, { state: { labels: 'ui,board' } })
  await expect.poll(() => shownTiles(page)).toEqual(['MAIN-402'])
  await expect(words(page)).toHaveText(['and'])
})

test('Reset takes the reading out with the labels', async ({ page }) => {
  await bothPicked(page)
  await anyOf(page).click()
  await page.keyboard.press('Escape')
  await page.locator('.workspace-figures').getByRole('button', { name: 'Reset' }).click()
  await expect.poll(() => addressState(page)).toEqual({ view: 'kanban' })
  await openFacet(page, 'Label')
  await expect(allOf(page)).toHaveAttribute('aria-selected', 'true')
  await expect(menu(page).locator('.option-row[aria-selected="true"]')).toHaveCount(0)
})

test('the list reads the same answer', async ({ page }) => {
  await openSpace(page, { state: { view: 'list', labels: '%any,ui,board' } })
  await expect(page.locator('.work-item-list tbody tr')).toHaveCount(3)
  await expect(words(page)).toHaveText(['or'])
  await openFacet(page, 'Label')
  await allOf(page).click()
  await expect(page.locator('.work-item-list tbody tr')).toHaveCount(1)
})

test('the graph reads the same answer', async ({ page }) => {
  await openSpace(page, { state: { view: 'graph', labels: '%any,ui,board' } })
  await expect(page.locator('.graph-canvas.settled')).toBeVisible()
  const card = (reference: string) =>
    page.locator('.flow-node-card .flow-node-id').getByText(reference, { exact: true })
  await expect(card('MAIN-403')).toBeVisible()
  await expect(card('MAIN-404')).toBeVisible()
  await openFacet(page, 'Label')
  await allOf(page).click()
  await expect(page.locator('.graph')).not.toHaveAttribute('aria-busy', 'true')
  await expect(card('MAIN-402')).toBeVisible()
  await expect(card('MAIN-403')).toHaveCount(0)
  await expect(card('MAIN-404')).toHaveCount(0)
})

test('a label pressed on a tile joins in the reading in force', async ({ page }) => {
  await openSpace(page, { state: { labels: '%any,ui' } })
  await expect.poll(() => shownTiles(page)).toEqual(['MAIN-402', 'MAIN-403'])
  const held = page.locator('[data-reference="MAIN-402"]')
  await held.locator('.label-chip', { hasText: 'board' }).click()
  await expect(chips(page)).toHaveText(['Label: ui', 'Label: board'])
  await expect.poll(() => shownTiles(page)).toEqual(['MAIN-402', 'MAIN-403', 'MAIN-404'])
  await expect(words(page)).toHaveText(['or'])
  expect(addressState(page)).toMatchObject({ labels: '%any,ui,board' })
})

test('a label pressed in a card joins in the reading in force', async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 900 })
  await installDiscussionBackend(page)
  await page.goto(serializePlatformRoute({ module_id: 'planning', scope: projectScope }))
  await openFacet(page, 'Label')
  await anyOf(page).click()
  await page.keyboard.press('Escape')
  await page.locator('.work-item-column[data-state="dev"] .work-item-tile').first().click()
  const inCard = page.locator('.drawer .card-labels .label-chip')
  await inCard.first().click()
  await expect(chips(page)).toHaveCount(1)
  await inCard.nth(1).click()
  await expect(chips(page)).toHaveCount(2)
  await expect(words(page)).toHaveText(['or'])
  await expect
    .poll(() => addressState(page))
    .toMatchObject({ labels: expect.stringMatching(/^%any,/u) as unknown as string })
})

test('the keyboard reaches the choice along the arrows, and a screen reader hears it', async ({
  page,
}) => {
  await openSpace(page, { state: { labels: 'ui,board' } })
  await expect.poll(() => shownTiles(page)).toEqual(['MAIN-402'])
  await field(page).focus()
  await walkToChoice(page)
  await expect(await active(page)).toHaveAccessibleName('Labels: all of those picked')
  await expect(await active(page)).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('ArrowDown')
  await expect(await active(page)).toHaveAccessibleName('Labels: any of those picked')
  await page.keyboard.press('Enter')
  await expect(await active(page)).toHaveAttribute('aria-selected', 'true')
  await expect(field(page)).toBeFocused()
  await expect.poll(() => shownTiles(page)).toEqual(['MAIN-402', 'MAIN-403', 'MAIN-404'])
  // Next along the walk are the labels themselves.
  await page.keyboard.press('ArrowDown')
  await expect(await active(page)).toHaveText('board')
  await page.keyboard.press('Enter')
  await expect(chips(page)).toHaveText(['Label: ui'])
})

test('text typed to find a label stays when the reading changes, and goes with a pick', async ({
  page,
}) => {
  await openSpace(page, { state: { labels: 'ui' } })
  await field(page).fill('label')
  await anyOf(page).click()
  await expect(field(page)).toHaveValue('label')
  await expect(anyOf(page)).toHaveAttribute('aria-selected', 'true')
  await page.getByRole('option', { name: 'board', exact: true }).click()
  await expect(field(page)).toHaveValue('')
  await expect(chips(page)).toHaveText(['Label: ui', 'Label: board'])
})

test('the highlight stays on a value picked by its text as the list grows back', async ({
  page,
}) => {
  await openSpace(page, {})
  await field(page).fill('boa')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect(field(page)).toHaveValue('')
  const id = await field(page).getAttribute('aria-activedescendant')
  await expect(page.locator(`[id="${id}"]`)).toHaveText('board')
  await expect(page.locator(`[id="${id}"]`)).toBeInViewport()
})

test('with one label in the space there is nothing to combine, and no choice', async ({ page }) => {
  const items = labelledSpace().map((item) => ({
    ...item,
    labels: item.reference === 'MAIN-402' ? ['ui'] : [],
  }))
  await openSpace(page, { items })
  await openFacet(page, 'Label')
  await expect(page.getByRole('option', { name: 'ui', exact: true })).toBeVisible()
  await expect(anyOf(page)).toHaveCount(0)
})

test('the menu with the choice passes the accessibility checks', async ({ page }) => {
  await bothPicked(page)
  await anyOf(page).click()
  const results = await new AxeBuilder({ page })
    .include('.work-filter')
    .include('.workspace-chips')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze()
  expect(results.violations.map((violation) => violation.id)).toEqual([])
})

test('on a phone the choice and the chips hold inside the screen', async ({ page }) => {
  await bothPicked(page, 390)
  await anyOf(page).click()
  await expect(anyOf(page)).toBeInViewport()
  await page.keyboard.press('Escape')
  await expect(words(page)).toHaveText(['or'])
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBe(0)
})
