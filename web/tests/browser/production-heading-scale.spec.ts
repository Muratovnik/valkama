/**
 * A heading says its level before it is read (DESIGN.md, System rules): the type scale gives
 * each level one size in every module — the module's name `module`, a section `section`, a
 * group `emphasis`, a block `interface` and the label over a block's lines `dense` — so no
 * heading is the size of the level over it.
 *
 * Each surface chose its headings' sizes on its own, and a drawer set its sections a step
 * smaller than a page: a card's section stood at a group's 15px with its day groups at 15px
 * under it, and in Diagnostics «Needs attention» stood at the 16px of the section over it.
 * Where the context bar stacks its controls under the module's name, the name stepped down to
 * a section's 16px, the size of the first section under it.
 *
 * Memory has no screen of its own (its address opens Work); what it shows a person is the
 * card's Memory tab, measured here with the card.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { planningWorkItemEntity } from '@/shared/api/platformPlanningRefs.ts'
import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { REVIEW_PROMPT, reviewFields } from '../support/reviewQuestion.ts'
import { installBackend } from './backend.ts'
import { boardRoute } from './boardPage.ts'
import { enableExecutionTab } from './executionFixtures.ts'
import { projectScope, workItemRef } from './planningFixtures.ts'
import { asked, openQuestion } from './questionBackend.ts'
import { test } from './test.ts'

/** The levels, from the top down. */
const LEVELS = ['module', 'section', 'group', 'block', 'label'] as const
type Level = (typeof LEVELS)[number]

/** The step of the ramp each level takes, by the token that names it. */
const TOKEN: Record<Level, string> = {
  module: '--font-size-module',
  section: '--font-size-section',
  group: '--font-size-emphasis',
  block: '--font-size-interface',
  label: '--font-size-dense',
}

/** A heading by what it is, the element its words are drawn in, and the level it heads. */
type Heading = [what: string, selector: string, level: Level]

const CARD = serializePlatformRoute({
  module_id: 'planning',
  scope: projectScope,
  entity: planningWorkItemEntity(workItemRef),
})

const moduleName: Heading = ['the module name', '.context-bar .module-title', 'module']
const cardName: Heading = ["the card's name", '.drawer .drawer-frame-name', 'module']

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('valkama-locale', 'ru'))
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width: 1440, height: 900 })
})

/**
 * Each heading at its level's step, and none at or over the size of a level above its own,
 * on the screen as it stands. Every heading named must be on screen, or nothing was measured.
 */
async function expectScale(page: Page, screen: string, headings: Heading[]) {
  const steps = await page.evaluate(
    (tokens) =>
      Object.fromEntries(
        Object.entries(tokens).map(([level, token]) => [
          level,
          getComputedStyle(document.documentElement).getPropertyValue(token).trim(),
        ]),
      ),
    TOKEN,
  )
  const read: { level: Level; sizes: string[]; what: string }[] = []
  for (const [what, selector, level] of headings) {
    const shown = page.locator(selector).filter({ visible: true })
    await expect(shown.first(), `${screen}: ${what} is on screen`).toBeVisible()
    const sizes = await shown.evaluateAll((nodes) => nodes.map((n) => getComputedStyle(n).fontSize))
    read.push({ what, level, sizes })
  }
  const offStep = read.flatMap(({ what, level, sizes }) =>
    sizes
      .filter((size) => size !== steps[level])
      .map((size) => `${what} ${size}, its level ${level} is ${steps[level]}`),
  )
  // Soft, so a heading off its step still has its neighbours compared below.
  expect.soft(offStep, `${screen}: off its level's step`).toEqual([])
  const rank = (level: Level) => LEVELS.indexOf(level)
  const notUnder = read.flatMap((lower) =>
    read
      .filter((upper) => rank(upper.level) < rank(lower.level))
      .flatMap((upper) =>
        lower.sizes
          .filter((size) =>
            upper.sizes.some((over) => Number.parseFloat(size) >= Number.parseFloat(over)),
          )
          .map((size) => `${lower.what} ${size} under ${upper.what} ${upper.sizes.join('/')}`),
      ),
  )
  expect(notUnder, `${screen}: a heading as large as a level over it`).toEqual([])
}

test('the board names its module and its columns each at their step', async ({ page }) => {
  await installBackend(page)
  await page.goto(boardRoute())
  await expect(page.locator('.work-item-board [data-reference]').first()).toBeVisible()
  await expectScale(page, 'the board', [
    moduleName,
    ['a column head', '.work-item-column .column-name .state-label', 'label'],
  ])
})

test('the module name keeps its step where the context bar stacks its controls', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await installBackend(page)
  await page.goto(boardRoute())
  await expect(page.locator('.work-item-board [data-reference]').first()).toBeVisible()
  await expectScale(page, 'the board at 390px', [moduleName])
})

test("a card's sections, their groups and its Memory tab stand under the card's name", async ({
  page,
}) => {
  await enableExecutionTab(page)
  await installBackend(page, { closedWith: 'Готово и выпущено.' })
  await page.goto(CARD)
  const drawer = page.locator('.drawer')
  await expect(drawer.locator('.card-facts')).toBeVisible()
  await expect(drawer).toHaveCSS('transform', 'none')
  const tab = (name: string) => drawer.getByRole('tab', { name, exact: true })

  await expect(drawer.locator('.overview .section-header h3').first()).toHaveText('Описание')
  await expectScale(page, "the card's overview", [
    cardName,
    ['a section', '.drawer .overview .section-header h3', 'section'],
    ['the outcome', '.drawer .outcome-details .disclosure-summary', 'section'],
  ])

  await tab('Исполнение').click()
  await expect(drawer.locator('.executions h3')).toHaveText('Выполнения')
  await expectScale(page, "the card's executions", [
    cardName,
    ['the executions', '.drawer .executions h3', 'section'],
    ['a day of them', '.drawer .history-group h4', 'group'],
    ["an attempt's details", '.drawer .attempt-context .disclosure-summary', 'label'],
  ])

  await tab('Память').click()
  await expect(drawer.locator('.memory h3')).toHaveText('Память')
  await expectScale(page, "the card's memory", [
    cardName,
    ['the memory', '.drawer .memory h3', 'section'],
  ])

  await tab('Связи').click()
  await expectScale(page, "the card's relations", [
    cardName,
    ['a section', '.drawer .relations .section-header h3', 'section'],
    ['a kind of link', '.drawer .relation-group .disclosure-summary', 'label'],
  ])
})

test("a question's groups stand under the card's discussion and in the questions' dialog", async ({
  page,
}) => {
  const { drawer, card } = await openQuestion(page, [
    asked({ prompt: REVIEW_PROMPT, fields: reviewFields, title: 'Проверка проверок' }),
  ])
  await expect(drawer.locator('.card-facts')).toBeVisible()
  await expect(card.locator('.request-group-title').first()).toBeVisible()
  await expectScale(page, "the card's discussion", [
    cardName,
    ['the discussion', '.drawer .discussion .section-header h3', 'section'],
    ["a question's group", '.drawer .request-group-title', 'group'],
  ])

  await page.keyboard.press('Escape')
  await page.locator('.app-nav .work-action').filter({ hasText: 'Ждут моего ответа' }).click()
  const dialog = page.getByRole('dialog', { name: 'Ждут моего ответа' })
  await expect(dialog.locator('.request-group-title').first()).toBeVisible()
  await expectScale(page, "the questions' dialog", [
    ["the dialog's name", '[role=dialog] .overlay-header-name', 'module'],
    ['a task asking', '[role=dialog] .request-title', 'section'],
    ["a question's group", '[role=dialog] .request-group-title', 'group'],
  ])
})

test('Settings and its Diagnostics step down from the module name', async ({ page }) => {
  await installBackend(page)
  await page.goto(serializePlatformRoute({ module_id: 'settings', scope: projectScope }))
  await expect(page.locator('.settings-group .section-heading').first()).toBeVisible()
  await expectScale(page, 'General', [
    moduleName,
    ['a section', '.settings-group .section-heading', 'section'],
    ['a row', '.settings-row-label', 'label'],
  ])

  await page
    .getByRole('tablist', { name: 'Раздел настроек' })
    .getByRole('tab', { name: 'Диагностика' })
    .click()
  await expect(page.locator('.health-level').first()).toBeVisible()
  await page.locator('.health-passed').getByRole('button').first().click()
  await expect(page.locator('.health-passed-title').first()).toBeVisible()
  await expectScale(page, 'Diagnostics', [
    moduleName,
    ['the diagnostics', '.installation-health .health-head .section-heading', 'section'],
    ['what needs attention', '.health-section-head .section-heading', 'group'],
    ['the passed checks', '.health-passed > .disclosure-head .disclosure-summary', 'group'],
    ['a level needing attention', '.health-level-head .state-label', 'block'],
    ['a passed level', '.health-passed-title', 'block'],
    ['a finding', '.health-finding-state .state-label', 'label'],
  ])
})

/**
 * The screen's outline as a screen reader walks it, from the module's name down: each heading by
 * its rank and words, and the heading it stands under, the nearest one before it of a higher rank.
 * The navigation's own headings stand apart, before the module's name.
 */
const outline = (page: Page) =>
  page.evaluate(() => {
    const ranked = '.context-bar h1, .settings-page :is(h1, h2, h3, h4, h5, h6)'
    const headings = [...document.querySelectorAll(ranked)].map((heading) => ({
      rank: Number(heading.tagName.slice(1)),
      words: (heading.textContent ?? '').replaceAll(/\s+/gu, ' ').trim(),
    }))
    return headings.map((heading, index) => ({
      ...heading,
      under: headings
        .slice(0, index)
        .reverse()
        .find((before) => before.rank < heading.rank)?.words,
    }))
  })

/** The headings that skip a rank: a rank more than one under the heading before it. */
const skips = (headings: Awaited<ReturnType<typeof outline>>) =>
  headings
    .filter((heading, index) => heading.rank > (headings[index - 1]?.rank ?? 0) + 1)
    .map(({ rank, words }) => `h${rank} ${words}`)

test('Settings ranks its headings by their nesting, under the module name', async ({
  page,
}, info) => {
  await installBackend(page)
  await page.goto(serializePlatformRoute({ module_id: 'settings', scope: projectScope }))
  await expect(page.locator('.settings-group .section-heading').first()).toBeVisible()
  const general = await outline(page)
  expect.soft(skips(general), 'General: no rank skipped').toEqual([])
  const groups = general.filter((heading) => heading.under === 'Настройки')
  expect
    .soft(groups, 'General: its groups stand right under the module name')
    .toHaveLength(await page.locator('.settings-group').count())

  await page
    .getByRole('tablist', { name: 'Раздел настроек' })
    .getByRole('tab', { name: 'Диагностика' })
    .click()
  await expect(page.locator('.health-level').first()).toBeVisible()
  await page.locator('.health-passed').getByRole('button').first().click()
  await expect(page.locator('.health-passed-title').first()).toBeVisible()
  const diagnostics = await outline(page)
  await info.attach('outline', {
    body: JSON.stringify({ general, diagnostics }, null, 2),
    contentType: 'application/json',
  })
  expect.soft(skips(diagnostics), 'Diagnostics: no rank skipped').toEqual([])
  const under = (words: string) => diagnostics.find((heading) => heading.words === words)?.under
  expect.soft(under('Диагностика установки')).toBe('Настройки')
  expect.soft(under('Требует внимания')).toBe('Диагностика установки')
  // A passed level stands under the passed checks, not under what needs attention.
  const passed = await page.locator('.health-passed-title').allTextContents()
  expect(passed.length).toBeGreaterThan(0)
  for (const level of passed) expect.soft(under(level.trim()), level).toMatch(/^Успешные проверки/u)
})
