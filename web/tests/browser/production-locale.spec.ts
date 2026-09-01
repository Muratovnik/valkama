import { expect, test } from '@playwright/test'

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

    await sections.getByRole('button', { name: 'Рабочая область' }).click()
    await expect(page.getByRole('heading', { name: 'Разделы', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Интеграции', exact: true })).toBeVisible()
    await expect(page.getByText('Подробнее', { exact: true }).first()).toBeVisible()
    await expect(page.getByText('Наблюдаемое состояние', { exact: true }).first()).toBeVisible()
    await expectNoSilentClipping(page, `Russian Settings Workspace at ${width}px`)

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
