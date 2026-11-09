/**
 * A workflow state's name in the built application, in Russian: a space that kept the
 * workflow a new space is given reads its states in the interface's words, on the board's
 * columns, a list row, the card, the filter and the task finder; the one state it renamed
 * reads as written; and the owner's choice «как в процессе» brings back the workflow's own
 * names everywhere without a reload.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import type { WorkItemBrief } from '@/shared/api/planningModel.ts'

import { installBackend } from './backend.ts'
import { boardRoute } from './boardPage.ts'
import { planningReadModel, projectId, spaceRef, workItem } from './planningFixtures.ts'
import { planningReadFor } from './planningReadFixture.ts'
import { briefAnswer } from './previewPage.ts'
import { test } from './test.ts'

const identity = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

/** The workflow a new space is given, with Review renamed. */
const STATES = [
  ['backlog', 'Backlog', 'backlog', false],
  ['todo', 'Todo', 'queued', false],
  ['dev', 'Dev', 'active', false],
  ['review', 'Code review', 'review', false],
  ['done', 'Done', 'completed', true],
  ['blocked', 'Blocked', 'blocked', false],
  ['cancelled', 'Cancelled', 'cancelled', true],
] as const

/** Each state as an item holds it: the workflow's declaration without its place. */
const held = STATES.map(([key, name, category, terminal], index) => ({
  state_id: identity(950 + index),
  key,
  name,
  category,
  is_terminal: terminal,
}))
const states = held.map((state, index) => ({ ...state, position: index }))

const WORKFLOW = {
  ...planningReadModel.workflow,
  initial_state_id: states[0].state_id,
  states,
  transitions: states.slice(1).map((state, index) => ({
    from: states[index].state_id,
    to: state.state_id,
  })),
}

type Brief = (typeof planningReadModel.work_items)[number]
const stateOf = (key: string) => held.find((entry) => entry.key === key) ?? held[0]

const brief = (number: number, key: string) =>
  ({
    ...planningReadModel.work_items[1],
    work_item_id: identity(number),
    reference: `MAIN-${number}`,
    number,
    title: `Work in ${key}`,
    state: stateOf(key),
    ready: false,
    claim_ref: '',
    claim_state: null,
    parent_id: null,
  }) as Brief

const SPACE = [brief(11, 'todo'), brief(12, 'dev'), brief(13, 'review'), brief(14, 'done')]

/** What the finder answers: an item in Dev and one in the renamed state, with their marks. */
function finderAnswer() {
  const row = (item: Brief) => ({
    target: {
      project_id: projectId,
      space_ref: spaceRef,
      reference: item.reference,
      writable: true,
    },
    item: {
      work_item_id: item.work_item_id,
      planning_space_id: workItem.planning_space_id,
      reference: item.reference,
      title: item.title,
      kind: item.kind,
      priority: item.priority,
      state: { name: item.state.name, category: item.state.category, is_terminal: false },
      claim_ref: '',
    },
  })
  return {
    interface_version: 'valkama-planning-search',
    query: 'Work',
    limit: 50,
    has_more: false,
    items: [row(SPACE[1] as Brief), row(SPACE[2] as Brief)],
    coverage: [{ project_id: projectId, space_ref: spaceRef, status: 'searched', reason: null }],
  }
}

async function serveSpace(page: Page) {
  await installBackend(page)
  await page.route('**/api/planning?*', async (route) => {
    const response = planningReadFor(new URL(route.request().url()).searchParams)
    if (response.status === 200 && 'work_items' in response.body) {
      const body = response.body as unknown as Record<string, unknown>
      body.work_items = SPACE
      body.workflow = WORKFLOW
      body.links = []
    }
    await route.fulfill({
      status: response.status,
      contentType: 'application/json',
      body: JSON.stringify(response.body),
    })
  })
  await page.route('**/api/modules/planning/work-item?*', async (route) => {
    const wanted = new URL(route.request().url()).searchParams.get('reference')
    const found = SPACE.find((item) => item.reference === wanted) ?? (SPACE[1] as Brief)
    await route.fulfill(
      briefAnswer({ ...workItem, ...found, links: [] } as unknown as WorkItemBrief as never),
    )
  })
  await page.route('**/api/modules/planning/search?*', (route) =>
    route.fulfill({ json: finderAnswer() }),
  )
}

const column = (page: Page, key: string) =>
  page.locator(`.work-item-column[data-state="${key}"] .column-name .semantic-state`)
const columnNames = (page: Page) =>
  Promise.all(['todo', 'dev', 'review', 'done'].map((key) => column(page, key).textContent()))

/** The card of MAIN-12, opened from its tile; the state the card says. */
async function cardState(page: Page): Promise<Locator> {
  await page.locator('li[data-reference="MAIN-12"] .work-item-tile').click()
  const facts = page.locator('.drawer .card-facts')
  await expect(facts).toBeVisible()
  return facts.locator('.card-row-value').first()
}

async function closeCard(page: Page) {
  await page.keyboard.press('Escape')
  await expect(page.locator('.drawer .card-facts')).toHaveCount(0)
}

/** The finder's rows for «Work», each as the words it shows. */
async function finderRows(page: Page) {
  await page.keyboard.press('Control+k')
  const dialog = page.getByRole('dialog', { name: 'Перейти к задаче', exact: true })
  await dialog.getByRole('combobox').fill('Work')
  const options = dialog.getByRole('option')
  await expect(options).toHaveCount(2)
  const words = await options.allInnerTexts()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  return words
}

/** The state values the filter offers, by name. */
async function filterStates(page: Page) {
  await page.getByRole('combobox', { name: 'Фильтр работы' }).click()
  const menu = page.getByRole('listbox', { name: 'Признаки для фильтра' })
  await menu.getByRole('option', { name: 'Состояние', exact: true }).click()
  const names = await menu.getByRole('option').allInnerTexts()
  await page.keyboard.press('Escape')
  return names
}

const markDocument = (page: Page) =>
  page.evaluate(() => Object.assign(window, { sameDocument: true }))
const stillSameDocument = (page: Page) =>
  page.evaluate(() => (window as unknown as { sameDocument?: boolean }).sameDocument === true)

test.describe('in Russian', () => {
  test.use({ locale: 'ru-RU' })

  test('the standard states read translated, the renamed one as written, and the setting brings back the workflow’s names without a reload', async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await serveSpace(page)
    await page.goto(boardRoute())
    await expect(column(page, 'dev')).toBeVisible()

    // The board's column heads.
    expect(await columnNames(page)).toEqual(['К работе', 'В работе', 'Code review', 'Выполнено'])

    // A row of the list says its state.
    await page.goto(boardRoute({ view: 'list' }))
    // The row's cells: its reference, its title, then its state.
    const listed = (reference: string) =>
      page
        .getByRole('row', { name: new RegExp(`^${reference} `, 'u') })
        .getByRole('cell')
        .nth(2)
    await expect(listed('MAIN-12')).toHaveText('В работе')
    await expect(listed('MAIN-13')).toHaveText('Code review')

    // The card's state, and the filter's state values.
    await page.goto(boardRoute())
    await expect(await cardState(page)).toContainText('В работе')
    await closeCard(page)
    const offered = await filterStates(page)
    expect(offered).toEqual(expect.arrayContaining(['К работе', 'В работе', 'Проверка']))
    expect(offered.join(' ')).not.toMatch(/\b(?:Dev|Todo)\b/u)

    // Ctrl K: the finder names a result's state as the board does.
    const found = await finderRows(page)
    expect(found.join('\n')).toContain('В работе')
    expect(found.join('\n')).toContain('Code review')
    expect(found.join('\n')).not.toMatch(/\bDev\b/u)
    await page.screenshot({ path: testInfo.outputPath('state-names-translated.png') })

    // Settings, reached inside the app: «как в процессе».
    await markDocument(page)
    const areas = page.getByRole('navigation', { name: 'Разделы продукта' })
    await areas.getByRole('button', { name: 'Настройки', exact: true }).click()
    const naming = page.getByRole('combobox', { name: 'Названия состояний' })
    await expect(naming).toHaveText(/Перевод/u)
    await naming.click()
    await page.getByRole('option', { name: 'Как в процессе', exact: true }).click()
    await expect(naming).toHaveText(/Как в процессе/u)
    await areas.getByRole('button', { name: 'Работа', exact: true }).click()

    await expect(column(page, 'dev')).toHaveText('Dev')
    expect(await columnNames(page)).toEqual(['Todo', 'Dev', 'Code review', 'Done'])
    await expect(await cardState(page)).toContainText('Dev')
    await closeCard(page)
    const written = await finderRows(page)
    expect(written.join('\n')).toMatch(/\bDev\b/u)
    expect(written.join('\n')).not.toContain('В работе')
    expect(await stillSameDocument(page)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath('state-names-as-written.png') })
  })
})
