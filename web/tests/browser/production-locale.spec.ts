import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { installBackend } from './backend.ts'
import { expectNoSilentClipping } from './overflow.ts'
import { globalScope, projectScope } from './planningFixtures.ts'

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
  const sections = page.getByRole('group', { name: 'Раздел настроек' })
  for (const width of [1440, 1024, 816, 360]) {
    await page.setViewportSize({ width, height: 900 })
    await sections.getByRole('button', { name: 'Общие' }).click()
    await expect(page.getByRole('heading', { name: 'Открытие сессий', exact: true })).toBeVisible()
    await expectNoSilentClipping(page, `Russian Settings General at ${width}px`)

    await expect(sections.getByRole('button')).toHaveText(['Общие', 'Диагностика'])
    await expect(page.getByRole('heading', { name: 'Интеграции', exact: true })).toHaveCount(0)

    await sections.getByRole('button', { name: 'Диагностика' }).click()
    await expect(page.getByRole('heading', { name: 'Диагностика установки' })).toBeVisible()
    await expect(page.locator('.health-titleline').first()).toContainText('Требует внимания')
    await expectNoSilentClipping(page, `Russian Settings Diagnostics at ${width}px`)
  }
  expect(failures).toEqual([])
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

test('Russian Work bar keeps its controls on one row and folds the queue at narrow widths', async ({
  page,
}) => {
  await installBackend(page)
  await page.goto(serializePlatformRoute({ module_id: 'planning', scope: projectScope }))
  await expect(page.locator('.work-item-tile').first()).toBeVisible()
  const queueSegments = page.getByRole('group', { name: 'Очередь работы' })
  const queueMenu = page.getByRole('combobox', { name: 'Очередь работы' })

  for (const [width, height] of [
    [1440, 900],
    [1024, 768],
  ]) {
    await page.setViewportSize({ width, height })
    await expect(page.getByRole('switch', { name: 'Группировать доску по эпикам' })).toBeVisible()
    expect(oneLine(await toolBoxes(page)), `one row at ${width}px`).toBe(true)
    // Two rows: the controls, then the counts beside «Новая работа».
    const head = await page.locator('.workspace-head').boundingBox()
    expect(head?.height ?? Infinity, `bar height at ${width}px`).toBeLessThanOrEqual(100)
    await expectNoSilentClipping(page, `Russian Work bar at ${width}px`)
  }
  await page.setViewportSize({ width: 1440, height: 900 })
  await expect(queueSegments).toBeVisible()
  await expect(queueMenu).toBeHidden()
  await page.setViewportSize({ width: 1024, height: 768 })
  await expect(queueSegments).toBeHidden()
  await expect(queueMenu).toHaveText('Вся работа')

  await page.setViewportSize({ width: 390, height: 844 })
  await expect(queueMenu).toBeVisible()
  // The counts share a row with «Новая работа» rather than pushing it below.
  const status = await page
    .locator('.workspace-figures, .workspace-action')
    .evaluateAll((elements) =>
      elements.map((element) => {
        const box = element.getBoundingClientRect()
        return { top: box.top, bottom: box.bottom }
      }),
    )
  expect(status).toHaveLength(2)
  expect(oneLine(status)).toBe(true)
  const stage = await page.locator('.workspace-stage').boundingBox()
  expect(844 - (stage?.y ?? 844), 'the work gets most of the window').toBeGreaterThan(844 / 2)
  await expectNoSilentClipping(page, 'Russian Work bar at 390px')

  await queueMenu.click()
  await page.getByRole('option', { name: 'Заблокировано' }).click()
  await expect(queueMenu).toHaveText('Заблокировано')
  await page.setViewportSize({ width: 1440, height: 900 })
  await expect(queueSegments.getByRole('button', { name: 'Заблокировано' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
})
