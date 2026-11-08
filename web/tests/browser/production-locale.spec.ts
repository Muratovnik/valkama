import { expect } from '@playwright/test'
import type { Page, Route } from '@playwright/test'

import { planningSpaceEntity } from '@/shared/api/platformPlanningRefs.ts'
import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { installBackend } from './backend.ts'
import { answerFilePlans, copiedIn, keepCopies, noticeOf } from './documentEditorPlan.ts'
import { openPage, shot } from './documentPageSurface.ts'
import { expectNoSilentClipping } from './overflow.ts'
import { globalScope, projectScope, spaceRef } from './planningFixtures.ts'
import { test } from './test.ts'

test('Russian production shell localizes Settings without runtime failures', async ({ page }) => {
  const failures: string[] = []
  page.on('pageerror', (error) => failures.push(`page: ${error.message}`))
  page.on('console', (message) => {
    if (message.type() === 'error') failures.push(`console: ${message.text()}`)
  })
  page.on('requestfailed', (request) => {
    failures.push(`request: ${request.method()} ${request.url()}`)
  })

  await installBackend(page)
  await page.goto(serializePlatformRoute({ module_id: 'settings', scope: projectScope }))

  await expect(page.getByRole('heading', { level: 1, name: 'Настройки' })).toBeVisible()
  const sections = page.getByRole('tablist', { name: 'Раздел настроек' })
  for (const width of [1440, 1024, 816, 360]) {
    await page.setViewportSize({ width, height: 900 })
    await sections.getByRole('tab', { name: 'Общие' }).click()
    await expect(
      page.getByRole('heading', { name: 'Открытие сессий и файлов', exact: true }),
    ).toBeVisible()
    await expectNoSilentClipping(page, `Russian Settings General at ${width}px`)

    await expect(sections.getByRole('tab')).toHaveText(['Общие', 'Диагностика'])
    await expect(page.getByRole('heading', { name: 'Интеграции', exact: true })).toHaveCount(0)

    await sections.getByRole('tab', { name: 'Диагностика' }).click()
    await expect(page.getByRole('heading', { name: 'Диагностика установки' })).toBeVisible()
    await expect(page.locator('.health-titleline').first()).toContainText('Требует внимания')
    await expectNoSilentClipping(page, `Russian Settings Diagnostics at ${width}px`)
  }
  expect(failures).toEqual([])
})

test('Russian Settings names the task type colours and each colour field by its type', async ({
  page,
}) => {
  await installBackend(page)
  await page.goto(serializePlatformRoute({ module_id: 'settings', scope: projectScope }))
  await expect(page.getByRole('heading', { name: 'Цвета типов задач', exact: true })).toBeVisible()
  for (const word of ['Дефект', 'Эпик', 'Улучшение', 'Задача'])
    await expect(page.getByLabel(`Цвет типа «${word}»`, { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Сбросить все цвета', exact: true })).toBeDisabled()
})

test('Russian Planning portfolio presents an unbound project through typed localized state', async ({
  page,
}) => {
  await installBackend(page, { includeUnboundPlanningProject: true })
  await page.goto(serializePlatformRoute({ module_id: 'planning', scope: globalScope }))

  const project = page.locator('.portfolio-project').filter({ hasText: 'unbound-project' })
  await expect(project.getByText('Не связан', { exact: true })).toBeVisible()
  await expect(project).toContainText('Привязанных пространств пока нет.')
  await expect(project).toContainText('Проверить настройку проекта')
  await expect(project).not.toContainText('No owner Planning-space binding')
  await expect(project.locator('.binding-reason')).toHaveCount(0)
})

/** The vertical extent of each control in the bar's first row that is drawn. */
async function toolBoxes(page: Page) {
  return page.locator('.workspace-tools > *').evaluateAll((elements) =>
    elements
      .filter((element) => (element as HTMLElement).offsetParent !== null)
      .map((element) => {
        const box = element.getBoundingClientRect()
        return { top: box.top, bottom: box.bottom }
      }),
  )
}

/** Whether every box shares one line: each starts above where every other ends. */
function oneLine(boxes: { bottom: number; top: number }[]) {
  return Math.max(...boxes.map((box) => box.top)) < Math.min(...boxes.map((box) => box.bottom))
}

/** The room the filter's text has, and what stands where in the bar. */
async function barAt(page: Page) {
  return page.evaluate(() => {
    const box = (selector: string) => document.querySelector(selector)?.getBoundingClientRect()
    const word = document.querySelector('.grouping-word')
    return {
      field: box('.filter-box')?.width ?? 0,
      fieldTop: box('.filter-box')?.top ?? 0,
      groupingTop: box('.workspace-grouping')?.top ?? 0,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      word: word !== null && getComputedStyle(word).display !== 'none',
    }
  })
}

// The field never holds less than a phone gives it, which is what its short hint
// is sized for, and the grouping keeps its word on the row or on the line under it.
for (const [width, onRow] of [
  [1440, true],
  [1260, true],
  [1024, true],
  [996, true],
  [990, false],
  [900, false],
  [888, false],
  [880, false],
  [820, false],
  [760, false],
  [700, false],
  [690, false],
  [680, false],
  [390, false],
] as const) {
  test(`the Russian grouping keeps its word beside a field that works at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 })
    await installBackend(page)
    await page.goto(serializePlatformRoute({ module_id: 'planning', scope: projectScope }))
    await expect(page.locator('.work-item-tile').first()).toBeVisible()
    const bar = await barAt(page)
    expect(bar.word, 'the word is drawn').toBe(true)
    expect(bar.field, 'the field is usable').toBeGreaterThanOrEqual(100)
    expect(bar.overflow, 'the page does not scroll sideways').toBe(0)
    expect(bar.groupingTop === bar.fieldTop, 'the word rides the row where it fits').toBe(onRow)
  })
}

test('every order of the Russian phone list has its whole name', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await installBackend(page)
  await page.goto(
    serializePlatformRoute({
      module_id: 'planning',
      scope: projectScope,
      entity: planningSpaceEntity(spaceRef),
      state: { view: 'list' },
    }),
  )
  const head = page.locator('.work-item-list thead')
  const choice = head.getByRole('combobox', { name: 'Сортировать по' })
  await expect(choice).toHaveText('Обновлено')
  const cut = () =>
    choice.locator('.choice-title').evaluate((title) => title.scrollWidth - title.clientWidth)
  expect(await cut(), 'the order the list opens on is whole').toBeLessThanOrEqual(0)
  for (const order of ['Состояние', 'Приоритет', 'Исполнитель', 'Шаги', 'Обновлено']) {
    await choice.click()
    await page.getByRole('option', { name: order, exact: true }).click()
    await expect(choice).toHaveText(order)
    expect(await cut(), `${order} is whole`).toBeLessThanOrEqual(0)
  }
  // Where the head has the room it stays on one line with the title's sort.
  await page.setViewportSize({ width: 430, height: 844 })
  const sort = await head.getByRole('button', { name: 'Название', exact: true }).boundingBox()
  const box = await choice.boundingBox()
  expect(box?.y ?? Infinity).toBeLessThan((sort?.y ?? 0) + (sort?.height ?? 0))
})

test('Russian Work bar keeps its controls on one row and folds the presets at narrow widths', async ({
  page,
}) => {
  await installBackend(page)
  await page.goto(serializePlatformRoute({ module_id: 'planning', scope: projectScope }))
  await expect(page.locator('.work-item-tile').first()).toBeVisible()
  const presets = page.getByRole('group', { name: 'Быстрые фильтры' })
  const field = page.getByRole('combobox', { name: 'Фильтр работы' })

  for (const [width, height] of [
    [1440, 900],
    [1024, 768],
  ]) {
    await page.setViewportSize({ width, height })
    await expect(page.getByRole('button', { name: 'Группировать доску по эпикам' })).toBeVisible()
    expect(oneLine(await toolBoxes(page)), `one row at ${width}px`).toBe(true)
    // One row of controls, one line of state.
    const head = await page.locator('.workspace-head').boundingBox()
    expect(head?.height ?? Infinity, `bar height at ${width}px`).toBeLessThanOrEqual(84)
    await expect(page.locator('.workspace-figures')).toContainText('открыт')
    await expectNoSilentClipping(page, `Russian Work bar at ${width}px`)
  }
  await page.setViewportSize({ width: 1440, height: 900 })
  await expect(presets).toBeVisible()
  await page.setViewportSize({ width: 1024, height: 768 })
  // Where the row cannot hold them, the presets are the menu's first group.
  await expect(presets).toBeHidden()
  await field.click()
  await expect(page.getByRole('group', { name: 'Быстрые фильтры' })).toBeVisible()
  await page.getByRole('option', { name: 'В работе' }).click()
  await page.keyboard.press('Escape')
  await expect(page.locator('.workspace-chips .filter-chip')).toHaveText(['Состояние: В работе'])

  await page.setViewportSize({ width: 390, height: 844 })
  const stage = await page.locator('.workspace-stage').boundingBox()
  expect(844 - (stage?.y ?? 844), 'the work gets most of the window').toBeGreaterThan(844 / 2)
  await expectNoSilentClipping(page, 'Russian Work bar at 390px')
})

/**
 * The context bar names the module once and says nothing else about it. A line
 * under the name that describes what the module is tells the reader what the
 * rail and the screen already show, and it took a second row of the header for it.
 */
test('the context bar names each module and adds no introductory copy', async ({ page }) => {
  await installBackend(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  for (const [module, name] of [
    ['planning', 'Работа'],
    ['settings', 'Настройки'],
  ] as const) {
    await page.goto(serializePlatformRoute({ module_id: module, scope: projectScope }))
    const title = page.locator('.context-title')
    await expect(title.getByRole('heading', { level: 1, name })).toBeVisible()
    await expect(title).toHaveText(name)
  }
})

/**
 * A failed read says what failed, and a technical code only when there is one.
 * The planning read and its stream failing together once left the panel
 * reading «технический код: » with nothing after it. A server-side failure with
 * no error envelope once read «технический код: unavailable», a raw word for the
 * operator; it now reads the local service sentence.
 */
for (const [shape, fail, reason] of [
  [
    'an empty 500',
    (route: Route) => route.fulfill({ status: 500, body: '' }),
    'Локальный сервис не завершил запрос.',
  ],
  [
    'a dropped connection',
    (route: Route) => route.abort('connectionreset'),
    'Нет связи с локальным сервисом. Повторите, когда связь вернётся.',
  ],
] as const) {
  for (const width of [1440, 390]) {
    test(`a failed Work read after ${shape} names its cause and no technical code at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 })
      await installBackend(page)
      await page.route('**/api/planning?*', fail)
      await page.route('**/api/events?*', (route) => route.abort('failed'))
      await page.goto(
        serializePlatformRoute({
          module_id: 'planning',
          scope: projectScope,
          state: { view: 'list' },
        }),
      )
      const panel = page.locator('.platform-state-panel')
      await expect(
        panel.getByRole('heading', { name: 'Не удалось загрузить представление' }),
      ).toBeVisible()
      await expect(panel.getByRole('button', { name: 'Повторить' })).toBeVisible()
      await expect(panel).toContainText(reason)
      await expect(panel).not.toContainText(/код:\s*\)/u)
      await expect(panel).not.toContainText('unavailable')
      await expect(panel).not.toContainText('{code}')
    })
  }
}

for (const width of [1280, 390]) {
  test(`a Russian document's head opens it in the editor, and says why it could not at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 })
    await keepCopies(page)
    await openPage(page, 'docs/plan.md', '#kb:a7f3')
    await answerFilePlans(page, true)
    const editor = page.getByRole('button', { name: 'Открыть в VS Code', exact: true })
    await expect(editor).toHaveAttribute(
      'data-tooltip',
      'Открыть этот файл в VS Code на строке, которую вы читаете',
    )
    await editor.click()
    await expect(noticeOf(page)).toHaveText('Там ничего нет. Путь скопирован')
    expect(await copiedIn(page)).toEqual(['docs/plan.md'])
    await expectNoSilentClipping(page, `Russian document page at ${width}px`)
    await shot(page, `doc-${width}-ru`)
  })
}
