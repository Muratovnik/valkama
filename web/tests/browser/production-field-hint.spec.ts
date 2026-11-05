/**
 * A field's hint says something about the field; it is not part of the control.
 *
 * The frame used to be one `<label>` round the label, the control and the hint, and a
 * label passes a pointer on any of it to its control: resting on the hint under the
 * labels lit their input as hovered, and the hint stood inside what named the
 * control. The label's own words still hover the control, as a label does.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { installBackend } from './backend.ts'
import { projectScope } from './planningFixtures.ts'
import { test } from './test.ts'

const BOARD = serializePlatformRoute({ module_id: 'planning', scope: projectScope })

async function openComposer(page: Page) {
  await page.setViewportSize({ width: 1280, height: 900 })
  await installBackend(page)
  await page.goto(BOARD)
  await page.getByRole('button', { name: 'New work item' }).click()
  const dialog = page.getByRole('dialog', { name: 'New work' })
  await expect(dialog).toHaveCSS('transform', 'none')
  return dialog
}

const HINT = 'pick one, or type a new one'

const hovered = (control: Locator) => control.evaluate((node) => node.matches(':hover'))

test('a pointer on a hint leaves its field unhovered, and one on the label hovers it', async ({
  page,
}) => {
  const dialog = await openComposer(page)
  const control = dialog.getByRole('combobox', { name: 'Labels', exact: true })
  const hint = dialog.getByText(HINT, { exact: true })
  const label = dialog.getByText('Labels', { exact: true })

  // The edge is the box the field is drawn in.
  const edge = () =>
    control.evaluate((node) => getComputedStyle(node.closest('.combo-box') ?? node).borderColor)
  await page.mouse.move(1, 1)
  const resting = await edge()
  await hint.hover()
  expect(await hovered(control)).toBe(false)
  expect(await edge()).toBe(resting)

  await label.hover()
  expect(await hovered(control)).toBe(true)
  await control.hover()
  expect(await hovered(control)).toBe(true)
})

test('the hint describes its field rather than naming it', async ({ page }) => {
  const dialog = await openComposer(page)
  const control = dialog.getByRole('combobox', { name: 'Labels', exact: true })
  await expect(control).toHaveAccessibleName('Labels')
  await expect(control).toHaveAccessibleDescription(HINT)
  // A press on the hint is not a press on the field.
  await dialog.getByText(HINT, { exact: true }).click()
  await expect(control).not.toBeFocused()
  await dialog.getByText('Labels', { exact: true }).click()
  await expect(control).toBeFocused()
})
