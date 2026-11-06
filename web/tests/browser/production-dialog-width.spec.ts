/**
 * A dialog floats in a wide window, with a gutter round it, and in a window as narrow as one
 * where a drawer takes the whole width it takes the whole width too, with a smaller inset
 * that its head, body and foot share. The gutter and the dialog's own 24px inset inside it
 * took a phone's column twice over: in the questions waiting for an answer, an option's
 * text had 184px of a 390px window.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { installBackend } from './backend.ts'
import { projectScope } from './planningFixtures.ts'
import { asked, crowdedField, openQuestion } from './questionBackend.ts'
import { test } from './test.ts'

/** Where a box stands across the window, in whole pixels. */
async function across(box: Locator) {
  const bounds = await box.boundingBox()
  return { left: Math.round(bounds?.x ?? -1), width: Math.round(bounds?.width ?? -1) }
}

/** The left edge of a box's content, inside its padding. */
const contentLeft = (box: Locator) =>
  box.evaluate((node) => {
    const style = getComputedStyle(node)
    return Math.round(
      node.getBoundingClientRect().left +
        Number.parseFloat(style.borderLeftWidth) +
        Number.parseFloat(style.paddingLeft),
    )
  })

async function openQuestions(page: Page, width: number) {
  await page.setViewportSize({ width, height: 844 })
  const { drawer } = await openQuestion(page, [asked({ fields: [crowdedField] })])
  await page.keyboard.press('Escape')
  await expect(drawer).toHaveCount(0)
  await page.getByRole('button', { name: /^Needs my answer/u }).click()
  const dialog = page.getByRole('dialog', { name: 'Needs my answer', exact: true })
  await expect(dialog.locator('.request-option').first()).toBeVisible()
  await expect(dialog).toHaveCSS('transform', 'none')
  return dialog
}

test('on a phone the questions take the whole width, and an option its share of it', async ({
  page,
}) => {
  const dialog = await openQuestions(page, 390)
  expect(await across(dialog)).toEqual({ left: 0, width: 390 })
  const frame = dialog.locator('.dialog-frame')
  await expect(frame).toHaveCSS('border-radius', '0px')
  // Head, body and foot keep one inset, so the title stands over the first line of the list.
  const body = dialog.locator('.dialog-frame-body')
  await expect(body).toHaveCSS('padding-left', '16px')
  const title = await across(dialog.getByRole('heading', { name: 'Needs my answer' }))
  expect(title.left).toBe(await contentLeft(body))
  // What an option says has most of the window, not half of it.
  const text = await across(dialog.locator('.request-option-line').first())
  expect(text.width).toBeGreaterThanOrEqual(260)
})

test('in a wide window the questions float at their own width, inset as before', async ({
  page,
}) => {
  const dialog = await openQuestions(page, 1500)
  expect(await across(dialog)).toEqual({ left: 430, width: 640 })
  await expect(dialog.locator('.dialog-frame')).toHaveCSS('border-radius', '10px')
  await expect(dialog.locator('.dialog-frame-body')).toHaveCSS('padding-left', '24px')
})

test('on a phone the finder takes the width too, and still stands just under the top', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await installBackend(page)
  await page.goto(serializePlatformRoute({ module_id: 'planning', scope: projectScope }))
  await page.keyboard.press('Control+k')
  const dialog = page.getByRole('dialog', { name: 'Find a task', exact: true })
  // Where it rests, once it has stepped up from just below.
  await expect(dialog).toHaveCSS('transform', 'none')
  expect(await across(dialog)).toEqual({ left: 0, width: 390 })
  const bounds = await dialog.boundingBox()
  expect(Math.round(bounds?.y ?? -1)).toBe(4)
})

test('in a narrow window two fields side by side keep their inputs level, whatever their hints', async ({
  page,
}) => {
  // The narrowest window where Labels and Epic still share a row: on a phone they stand one
  // above the other, so that an epic's title has the dialog's width.
  await page.setViewportSize({ width: 560, height: 844 })
  await installBackend(page)
  await page.goto(serializePlatformRoute({ module_id: 'planning', scope: projectScope }))
  await page.getByRole('button', { name: 'New work item' }).click()
  const dialog = page.getByRole('dialog', { name: 'New work' })
  await expect(dialog).toHaveCSS('transform', 'none')
  // The labels have a hint under them and the epic none.
  const labels = await dialog.getByRole('combobox', { name: 'Labels' }).boundingBox()
  const epic = await dialog.getByRole('combobox', { name: 'Epic' }).boundingBox()
  expect(labels?.x ?? 0).toBeLessThan(epic?.x ?? 0)
  expect(Math.round(labels?.y ?? -1)).toBe(Math.round(epic?.y ?? -2))
})
