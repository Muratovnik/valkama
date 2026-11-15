/**
 * A kind's colour in the built application: the defaults on every surface that
 * shows a kind, what they read at there, an owner's choice reaching all of them at
 * once and surviving a reload without a flash of the default, the resets, and a
 * forced palette taking the colours back.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { boardId } from '../fixtures/board.ts'
import { openFacet, menu as valuesMenu } from './filterPage.ts'
import {
  colorOf,
  contrastOf,
  DEFAULTS,
  frame,
  glyphIn,
  KINDS,
  node,
  openBoard,
  openCard,
  openGraph,
  openList,
  painted,
  row,
  serveKinds,
  SETTINGS,
  tile,
  watchFirstGlyph,
  wordIn,
} from './kindColorsPage.ts'
import { expectNoSilentClipping } from './overflow.ts'
import { projectId, spaceRef, workItem } from './planningFixtures.ts'
import { card, held, openHub, reference, rest } from './previewPage.ts'
import { test } from './test.ts'

const WORD = 4.5
const GLYPH = 3

async function reads(element: Locator, floor: number, what: string) {
  const ratio = contrastOf(await painted(element))
  expect(ratio, `${what} stands at ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(floor)
}

const picker = (page: Page, word: string) => page.getByLabel(`${word} color`, { exact: true })

async function openSettings(page: Page) {
  await page.goto(SETTINGS)
  await expect(page.getByRole('heading', { name: 'Task type colors' })).toBeVisible()
}

const filterMenu = async (page: Page) => {
  await openFacet(page, 'Kind')
  return valuesMenu(page)
}

test('the defaults are on the tile, the list, the card and the graph, and paint no surface', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await serveKinds(page)

  await openBoard(page)
  await expect(glyphIn(tile(page, 'bug'))).toHaveCSS('color', DEFAULTS.bug)
  await expect(glyphIn(tile(page, 'improvement'))).toHaveCSS('color', DEFAULTS.improvement)
  // A plain task has no glyph, and a kind colours nothing but its mark.
  await expect(glyphIn(tile(page, 'task'))).toHaveCount(0)
  const sheet = await tile(page, 'task').evaluate((node) => getComputedStyle(node).backgroundColor)
  await expect(tile(page, 'bug')).toHaveCSS('background-color', sheet)

  await openList(page)
  await expect(glyphIn(row(page, 'goal'))).toHaveCSS('color', DEFAULTS.goal)
  await expect(glyphIn(row(page, 'bug'))).toHaveCSS('color', DEFAULTS.bug)
  await expect(glyphIn(row(page, 'improvement'))).toHaveCSS('color', DEFAULTS.improvement)
  await expect(glyphIn(row(page, 'task'))).toHaveCount(0)

  for (const kind of KINDS) {
    const drawer = await openCard(page, kind)
    const word = wordIn(drawer.locator('.identity-kind'))
    await expect(word).toHaveCSS('color', DEFAULTS[kind])
  }
  const goalCard = await openCard(page, 'goal')
  await expect(glyphIn(goalCard.locator('.identity-kind'))).toHaveCSS('color', DEFAULTS.goal)

  await openGraph(page)
  await expect(glyphIn(node(page, 'bug'))).toHaveCSS('color', DEFAULTS.bug)
  await expect(glyphIn(node(page, 'improvement'))).toHaveCSS('color', DEFAULTS.improvement)
  await expect(frame(page).locator('.graph-frame-kind')).toHaveCSS('color', DEFAULTS.goal)
  // The goal's frame is told by tone, and takes none of the kind's hue.
  const ground = await frame(page).evaluate((element) => getComputedStyle(element).backgroundColor)
  expect(ground).not.toBe(DEFAULTS.goal)
})

test('every default reads at 4.5:1 as a word and 3:1 as a glyph, at rest and pointed at', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await serveKinds(page)

  await openBoard(page)
  for (const kind of ['bug', 'improvement'] as const) {
    await reads(glyphIn(tile(page, kind)), GLYPH, `${kind} on a tile`)
    await tile(page, kind).hover()
    await reads(glyphIn(tile(page, kind)), GLYPH, `${kind} on a pointed-at tile`)
  }

  await openList(page)
  for (const kind of ['bug', 'goal', 'improvement'] as const) {
    await reads(glyphIn(row(page, kind)), GLYPH, `${kind} in a row`)
    await row(page, kind).hover()
    await reads(glyphIn(row(page, kind)), GLYPH, `${kind} in a pointed-at row`)
    await row(page, kind).locator('.list-open').focus()
    await reads(glyphIn(row(page, kind)), GLYPH, `${kind} in the focused row`)
  }

  for (const kind of KINDS) {
    const drawer = await openCard(page, kind)
    await reads(wordIn(drawer.locator('.identity-kind')), WORD, `${kind} in a card's head`)
  }

  await openList(page)
  const menu = await filterMenu(page)
  for (const word of ['Bug', 'Goal', 'Improvement', 'Task']) {
    const option = menu.getByRole('option', { name: word, exact: true })
    const text = option.locator('.option-text')
    await reads(text, WORD, `${word} in the filter menu`)
    await option.hover()
    await expect(option).toHaveAttribute('data-highlighted', 'true')
    await reads(text, WORD, `${word} highlighted in the filter menu`)
    await option.click()
    await reads(text, WORD, `${word} chosen in the filter menu`)
    await option.click()
  }

  await openGraph(page)
  for (const kind of ['bug', 'improvement'] as const) {
    await reads(glyphIn(node(page, kind)), GLYPH, `${kind} on a graph card`)
    await node(page, kind).hover()
    await reads(glyphIn(node(page, kind)), GLYPH, `${kind} on a pointed-at graph card`)
  }
  const frameGlyph = frame(page).locator('.graph-frame-kind')
  await reads(frameGlyph, GLYPH, 'the goal on its frame')
  await frame(page).locator('.graph-frame-open').hover()
  await reads(frameGlyph, GLYPH, 'the goal on its pointed-at frame')
})

test('a reference in a question shows the kind at 4.5:1 on the hover card, the lightest ground', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  const { dialog } = await openHub(page, [held(12, 'A goal to read', { kind: 'goal' })])
  await rest(page, reference(dialog, 'MAIN-12'))
  const mark = card(page).locator('[data-facet="kind"]')
  await expect(mark.locator('.facet-glyph')).toHaveCSS('color', DEFAULTS.goal)
  await expect(mark.locator('.facet-word')).toHaveCSS('color', DEFAULTS.goal)
  await reads(mark.locator('.facet-word'), WORD, 'the goal on the hover card')
})

test('a search result leads with its kind in its colour, at rest and highlighted', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await serveKinds(page)
  await page.route('**/api/modules/planning/search?*', (route) =>
    route.fulfill({
      json: {
        interface_version: 'valkama-planning-search',
        query: 'MAIN',
        limit: 50,
        has_more: false,
        items: (['goal', 'bug'] as const).map((kind, index) => ({
          target: {
            project_id: projectId,
            space_ref: spaceRef,
            reference: `MAIN-${901 + index}`,
            writable: true,
          },
          item: {
            work_item_id: boardId(901 + index),
            planning_space_id: workItem.planning_space_id,
            reference: `MAIN-${901 + index}`,
            title: `A ${kind} to find`,
            kind,
            priority: 'medium',
            state: { name: 'Dev', category: 'active' },
            claim_ref: '',
          },
        })),
        coverage: [
          { project_id: projectId, space_ref: spaceRef, status: 'searched', reason: null },
        ],
      },
    }),
  )
  await openList(page)
  await page.getByRole('button', { name: 'Go to a task' }).click()
  await page.getByRole('combobox').last().fill('MAIN')
  const rows = page.getByRole('option')
  await expect(rows).toHaveCount(2)
  const goal = rows.nth(0).locator('[data-kind="goal"] .facet-glyph')
  const bug = rows.nth(1).locator('[data-kind="bug"] .facet-glyph')
  await expect(goal).toHaveCSS('color', DEFAULTS.goal)
  await expect(bug).toHaveCSS('color', DEFAULTS.bug)
  await expect(rows.nth(0)).toHaveAttribute('data-highlighted', '')
  await reads(goal, GLYPH, 'the goal on the highlighted result')
  await reads(bug, GLYPH, 'the bug on a result at rest')
})

test('a colour chosen in Settings is everywhere at once and survives a reload without a flash', async ({
  page,
}) => {
  const CHOSEN = 'rgb(18, 200, 86)'
  await page.setViewportSize({ width: 1280, height: 900 })
  await serveKinds(page)
  await openSettings(page)

  const name = page.locator('[data-kind="bug"]').first()
  await expect(name).toHaveCSS('color', DEFAULTS.bug)
  await picker(page, 'Bug').fill('#12c856')
  // On the page itself, with nothing reloaded.
  await expect(name).toHaveCSS('color', CHOSEN)
  await expect(picker(page, 'Bug')).toHaveValue('#12c856')

  // The other surfaces, reached through the rail: the same document, never reloaded.
  await page.evaluate(() => ((window as unknown as { sameDocument: boolean }).sameDocument = true))
  await page.getByRole('button', { name: 'Work', exact: true }).click()
  await expect(glyphIn(page.locator('[data-reference="MAIN-902"]').first())).toHaveCSS(
    'color',
    CHOSEN,
  )
  expect(await page.evaluate(() => 'sameDocument' in window)).toBe(true)

  await openList(page)
  await expect(glyphIn(row(page, 'bug'))).toHaveCSS('color', CHOSEN)
  await expect(glyphIn(row(page, 'goal'))).toHaveCSS('color', DEFAULTS.goal)
  const drawer = await openCard(page, 'bug')
  await expect(wordIn(drawer.locator('.identity-kind'))).toHaveCSS('color', CHOSEN)
  await openGraph(page)
  await expect(glyphIn(node(page, 'bug'))).toHaveCSS('color', CHOSEN)

  // Loaded anew: the first glyph the page ever holds already has the chosen colour.
  const firstGlyph = await watchFirstGlyph(page, 'bug')
  await openBoard(page)
  expect(await firstGlyph()).toBe(CHOSEN)
})

test('a row resets to its default, every row resets at once, and a poor colour is said and allowed', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await serveKinds(page)
  await openSettings(page)
  const hint = /hard to read on the dark background/i
  const resetAll = page.getByRole('button', { name: 'Reset all colors', exact: true })
  await expect(resetAll).toBeDisabled()
  await expect(page.getByText(hint)).toHaveCount(0)

  // The owner's choice stands: the canonical goal purple is too dark and is allowed.
  await picker(page, 'Goal and stage').fill('#a335ee')
  await picker(page, 'Task').fill('#102030')
  await expect(page.getByText(hint)).toHaveCount(2)
  await expect(page.locator('[data-kind="goal"]').first()).toHaveCSS('color', 'rgb(163, 53, 238)')
  await expect(picker(page, 'Goal and stage')).toHaveAccessibleDescription(hint)

  await page.getByRole('button', { name: 'Reset the Goal and stage color', exact: true }).click()
  await expect(picker(page, 'Goal and stage')).toHaveValue('#cfa0ff')
  await expect(page.locator('[data-kind="goal"]').first()).toHaveCSS('color', DEFAULTS.goal)
  await expect(page.locator('[data-kind="task"]').first()).toHaveCSS('color', 'rgb(16, 32, 48)')
  await expect(page.getByText(hint)).toHaveCount(1)

  await resetAll.click()
  await expect(page.locator('[data-kind="task"]').first()).toHaveCSS('color', DEFAULTS.task)
  await expect(page.getByText(hint)).toHaveCount(0)
  expect(
    await page.evaluate(() => document.documentElement.style.getPropertyValue('--color-kind-task')),
  ).toBe('')
})

test('a choice from before, or a broken one, reads as the default on the page', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'valkama-settings',
      JSON.stringify({ editor: 'cursor', kindColors: { container: 'url(x)', bug: '#123456' } }),
    )
  })
  await page.setViewportSize({ width: 1280, height: 900 })
  await serveKinds(page)
  await openList(page)
  await expect(glyphIn(row(page, 'goal'))).toHaveCSS('color', DEFAULTS.goal)
  await expect(glyphIn(row(page, 'bug'))).toHaveCSS('color', 'rgb(18, 52, 86)')
})

/**
 * A goal and a stage share one row, «Цель и этап», which a colour stored for a kind this build
 * does not have never reaches: the row starts from the default, its reset has nothing to do,
 * and the stored value is gone from the settings.
 */
for (const width of [1280, 390])
  test(`the goal and stage row is one, named in Russian, and starts from the default (${width}px)`, async ({
    page,
  }) => {
    await page.addInitScript(() => {
      localStorage.setItem('valkama-locale', 'ru')
      localStorage.setItem(
        'valkama-settings',
        JSON.stringify({ kindColors: { former: '#123456' } }),
      )
    })
    await page.setViewportSize({ width, height: 900 })
    await serveKinds(page)
    await page.goto(SETTINGS)
    await expect(page.getByRole('heading', { name: 'Цвета типов задач' })).toBeVisible()
    const field = page.getByLabel('Цвет типа «Цель и этап»', { exact: true })
    await expect(field).toHaveValue('#cfa0ff')
    await expect(
      page.getByRole('button', { name: 'Сбросить цвет типа «Цель и этап»', exact: true }),
    ).toBeDisabled()
    await expect(page.locator('[data-kind="goal"]').first()).toHaveCSS('color', DEFAULTS.goal)
    await expect(page.locator('[data-kind="goal"]').first()).toHaveText('Цель и этап')
    // One row for the two kinds, and nothing of the former kind kept.
    await expect(page.getByLabel(/^Цвет типа «(Цель|Этап)»$/u)).toHaveCount(0)
    expect(
      await page.evaluate(
        () => JSON.parse(localStorage.getItem('valkama-settings') ?? '{}').kindColors,
      ),
    ).toEqual({})
    await expectNoSilentClipping(page, `kind colours ru ${width}px`)
  })

test('each picker has its kind in its name and is reached from the keyboard', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await serveKinds(page)
  await openSettings(page)
  for (const word of ['Bug', 'Goal and stage', 'Improvement', 'Task']) {
    const input = picker(page, word)
    await expect(input).toHaveAttribute('type', 'color')
    await expect(input).toBeVisible()
  }
  await picker(page, 'Bug').focus()
  await page.keyboard.press('Tab')
  // The row's own reset does not take a stop while it has nothing to do.
  await expect(picker(page, 'Goal and stage')).toBeFocused()
  await expect(picker(page, 'Goal and stage')).toHaveCSS('outline-style', 'solid')
  const width = await page.evaluate(() => document.documentElement.scrollWidth)
  expect(width).toBeLessThanOrEqual(390)
})

test('a forced palette takes the colours, and the glyph and the word stay', async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active' })
  await page.setViewportSize({ width: 1280, height: 900 })
  await serveKinds(page)
  await openList(page)
  const inks = await Promise.all(
    (['bug', 'goal', 'improvement'] as const).map((kind) => colorOf(glyphIn(row(page, kind)))),
  )
  expect(new Set(inks).size).toBe(1)
  expect(Object.values(DEFAULTS)).not.toContain(inks[0])
  await expect(glyphIn(row(page, 'bug'))).toBeVisible()

  const drawer = await openCard(page, 'goal')
  const word = wordIn(drawer.locator('.identity-kind'))
  await expect(word).toHaveText('Goal')
  expect(Object.values(DEFAULTS)).not.toContain(await colorOf(word))
  await expect(glyphIn(drawer.locator('.identity-kind'))).toBeVisible()

  await openSettings(page)
  expect(Object.values(DEFAULTS)).not.toContain(
    await colorOf(page.locator('[data-kind="goal"]').first()),
  )
  await expect(picker(page, 'Goal and stage')).toBeVisible()
})
