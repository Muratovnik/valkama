import { expect, test } from '@playwright/test'

import { parsePlatformRoute, serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { installBackend } from './backend.ts'
import { expectNoSilentClipping } from './overflow.ts'
import { projectScope, workItemRef } from './planningFixtures.ts'

for (const width of [1440, 390]) {
  test(`inspector overlays the unchanged board and Escape returns focus at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 })
    await installBackend(page)
    await page.goto(serializePlatformRoute({ module_id: 'planning', scope: projectScope }))
    const workspace = page.locator('.workspace')
    const opener = page.locator('.work-item-column[data-state="dev"] .work-item-tile').first()
    await expect(opener).toBeVisible()
    const before = await workspace.boundingBox()
    await opener.click()
    const drawer = page.locator('.drawer')
    await expect(drawer).toBeVisible()
    await expect(drawer).toHaveCSS('transform', 'none')
    await expect(drawer.locator('.head-reference')).toHaveText(workItemRef.reference)
    expect(await workspace.boundingBox()).toEqual(before)
    const bounds = await drawer.boundingBox()
    expect(bounds).not.toBeNull()
    expect(bounds?.x).toBeGreaterThanOrEqual(0)
    expect((bounds?.x ?? Infinity) + (bounds?.width ?? Infinity)).toBeLessThanOrEqual(width)
    await page.keyboard.press('Escape')
    await expect(drawer).toHaveCount(0)
    await expect(opener).toBeFocused()
    await expect.poll(() => parsePlatformRoute(page.url()).entity?.kind).toBe('planning-space')
    expect(await workspace.boundingBox()).toEqual(before)
  })
}

test('Russian relations keep one hierarchy, aligned controls, and narrow content readable', async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem('valkama-locale', 'ru'))
  await page.setViewportSize({ width: 1440, height: 1000 })
  await installBackend(page)
  await page.goto(serializePlatformRoute({ module_id: 'planning', scope: projectScope }))
  await page.locator('.work-item-column[data-state="dev"] .work-item-tile').first().click()
  const drawer = page.locator('.drawer')
  await expect(drawer.locator('.head-claim')).toContainText('Ответственный: codex')
  await drawer.getByRole('checkbox', { name: 'Отчёт о работе', exact: true }).check()
  const result = drawer.getByRole('textbox', { name: 'Что сделано', exact: true })
  const longDraft =
    'Проверены связи между задачами, история решений и подробное описание результата. '.repeat(8)
  await result.fill(longDraft)
  await expect(result).toHaveValue(longDraft)
  await expect(result).toHaveCSS('font-size', '15px')
  const resultBox = await result.boundingBox()
  expect(resultBox?.height).toBeGreaterThanOrEqual(140)
  await drawer.getByRole('button', { name: 'Связи', exact: true }).click()
  await expect(drawer.getByRole('heading', { name: /^Связанная работа/ })).toHaveCount(1)
  await expect(drawer.getByRole('heading', { name: 'Свидетельства', exact: true })).toHaveCount(1)
  await expect(drawer.getByRole('heading', { name: 'Внешние ресурсы', exact: true })).toHaveCount(1)
  const splitter = drawer.getByRole('separator')
  await splitter.press('End')
  const add = drawer.getByRole('button', { name: 'Добавить связанную задачу', exact: true })
  await add.click()
  const picker = page.getByRole('dialog', { name: 'Связанная задача', exact: true })
  await expect(picker).toBeVisible()
  await expect(picker.getByRole('combobox', { name: 'Тип связи', exact: true })).toBeVisible()
  await expect(picker.getByRole('combobox', { name: 'Направление', exact: true })).toBeVisible()
  await page.setViewportSize({ width: 390, height: 900 })
  await expectNoSilentClipping(page, 'Russian inspector relations at 390px')
  await expect(
    picker.getByRole('textbox', { name: 'Ссылка, номер или название', exact: true }),
  ).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(picker).toHaveCount(0)
  await expect(drawer).toBeVisible()
  await expect(add).toBeFocused()
})
