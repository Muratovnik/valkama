import { expect, test } from '@playwright/test'

import { planningWorkItemEntity } from '@/shared/api/platformPlanningRefs.ts'
import { parsePlatformRoute, serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { installBackend } from './backend.ts'
import { expectNoSilentClipping } from './overflow.ts'
import {
  blockedWorkItem,
  projectId,
  projectScope,
  spaceRef,
  workItem,
  workItemRef,
} from './planningFixtures.ts'

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
  await expect(drawer.getByRole('heading', { name: 'Внешние ресурсы', exact: true })).toHaveCount(0)
  const splitter = drawer.getByRole('separator')
  await splitter.press('End')
  const add = drawer.getByRole('button', { name: 'Добавить связь', exact: true })
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

test('an unsent comment survives browser Back, global search and a reload until it is let go', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await installBackend(page)
  await page.route('**/api/modules/planning/search?*', (route) =>
    route.fulfill({
      json: {
        interface_version: 'valkama-planning-search',
        query: blockedWorkItem.reference,
        limit: 50,
        has_more: false,
        items: [
          {
            target: {
              project_id: projectId,
              space_ref: spaceRef,
              reference: blockedWorkItem.reference,
              writable: true,
            },
            item: {
              work_item_id: blockedWorkItem.work_item_id,
              planning_space_id: workItem.planning_space_id,
              reference: blockedWorkItem.reference,
              title: blockedWorkItem.title,
              state: { name: 'Todo' },
              claim_ref: '',
            },
          },
        ],
        coverage: [
          { project_id: projectId, space_ref: spaceRef, status: 'searched', reason: null },
        ],
      },
    }),
  )
  await page.goto(serializePlatformRoute({ module_id: 'planning', scope: projectScope }))
  await page.locator('.work-item-column[data-state="dev"] .work-item-tile').first().click()
  const drawer = page.locator('.drawer')
  await expect(drawer.locator('.head-reference')).toHaveText(workItemRef.reference)
  const itemUrl = page.url()
  const strip = drawer.locator('.confirm-strip')
  const comment = drawer.getByRole('textbox', { name: 'Comment', exact: true })
  /** What a reload or a closing tab sends: whether the page holds it. */
  const reloadHeld = () =>
    page.evaluate(() => {
      const event = new Event('beforeunload', { cancelable: true })
      window.dispatchEvent(event)
      return event.defaultPrevented
    })
  const findAndOpen = async () => {
    await page.keyboard.press('Control+k')
    const finder = page.getByRole('dialog', { name: 'Find a task', exact: true })
    await finder.getByRole('combobox').fill(blockedWorkItem.reference)
    await expect(finder.getByRole('option')).toContainText(blockedWorkItem.title)
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    await expect(finder).toBeHidden()
  }

  expect(await reloadHeld()).toBe(false)
  await comment.fill('Half a thought')
  expect(await reloadHeld()).toBe(true)

  // Browser Back asks; keeping the draft steps history back to the item.
  await page.goBack()
  await expect(strip).toContainText('Unsaved changes will be lost: comment')
  await strip.getByRole('button', { name: 'Keep editing', exact: true }).click()
  await expect(strip).toHaveCount(0)
  await expect(page).toHaveURL(itemUrl)
  await expect(comment).toHaveValue('Half a thought')

  // A route change the inspector did not start asks the same question.
  await findAndOpen()
  await expect(strip).toContainText('Unsaved changes will be lost: comment')
  await strip.getByRole('button', { name: 'Keep editing', exact: true }).click()
  await expect(page).toHaveURL(itemUrl)
  await expect(comment).toHaveValue('Half a thought')

  // Discarding lets the same move through, and the next item opens.
  await findAndOpen()
  await strip.getByRole('button', { name: 'Discard', exact: true }).click()
  await expect(page).toHaveURL(
    serializePlatformRoute({
      module_id: 'planning',
      scope: projectScope,
      entity: planningWorkItemEntity({ space_ref: spaceRef, reference: blockedWorkItem.reference }),
    }),
  )
  await expect(drawer.locator('.head-reference')).toHaveText(blockedWorkItem.reference)
  expect(await reloadHeld()).toBe(false)

  // With nothing typed, Back simply goes back.
  await page.goBack()
  await expect(drawer.locator('.head-reference')).toHaveText(workItemRef.reference)
  await expect(strip).toHaveCount(0)
})
