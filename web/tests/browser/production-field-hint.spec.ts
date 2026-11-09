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

import { planningSpaceEntity } from '@/shared/api/platformPlanningRefs.ts'
import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { installBackend } from './backend.ts'
import { enableExecutionTab } from './executionFixtures.ts'
import { projectScope, spaceRef } from './planningFixtures.ts'
import { test } from './test.ts'

const LIST = serializePlatformRoute({
  module_id: 'planning',
  scope: projectScope,
  entity: planningSpaceEntity(spaceRef),
  state: { view: 'list' },
})

/**
 * The launch form, whose repository field carries a hint. The new-task dialog's labels field
 * was the example here until its hint became the field's placeholder.
 */
async function openForm(page: Page) {
  await page.setViewportSize({ width: 1280, height: 900 })
  await enableExecutionTab(page)
  await installBackend(page)
  await page.goto(LIST)
  await page.locator('.work-item-list .list-open').first().click()
  const drawer = page.locator('.drawer')
  await drawer.getByRole('tab', { name: /^Execution$/iu }).click()
  await drawer.getByRole('button', { name: /Start an attempt/iu }).click()
  const dialog = page.getByRole('dialog', { name: /Start an attempt/iu })
  await expect(dialog).toHaveCSS('transform', 'none')
  return dialog
}

const NAME = 'Repository'
const HINT = 'the directory the session runs in'

const hovered = (control: Locator) => control.evaluate((node) => node.matches(':hover'))

test('a pointer on a hint leaves its field unhovered, and one on the label hovers it', async ({
  page,
}) => {
  const dialog = await openForm(page)
  const control = dialog.getByRole('textbox', { name: NAME, exact: true })
  const hint = dialog.getByText(HINT, { exact: true })
  const label = dialog.getByText(NAME, { exact: true })

  // The edge is the box the field is drawn in.
  const edge = () => control.evaluate((node) => getComputedStyle(node).borderColor)
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
  const dialog = await openForm(page)
  const control = dialog.getByRole('textbox', { name: NAME, exact: true })
  await expect(control).toHaveAccessibleName(NAME)
  await expect(control).toHaveAccessibleDescription(HINT)
  // A press on the hint is not a press on the field.
  await dialog.getByText(HINT, { exact: true }).click()
  await expect(control).not.toBeFocused()
  await dialog.getByText(NAME, { exact: true }).click()
  await expect(control).toBeFocused()
})
