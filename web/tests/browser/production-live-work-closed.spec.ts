/**
 * The phone's list of work going on now with the closed rows that keep their lead column: a
 * closed group head, a pinned closed epic and a closed item a session is still on. On a phone
 * only a closed row with neither a fold nor a sign drops its lead (`NavWorkRow`).
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { closedFrame } from '../support/liveFrame.ts'
import { installBackend } from './backend.ts'
import { settled } from './documentBeside.ts'
import { installLiveStreams, liveRow } from './liveWorkPage.ts'
import { globalScope } from './planningFixtures.ts'
import { test } from './test.ts'

const SETTINGS = serializePlatformRoute({ module_id: 'settings', scope: globalScope })

/** The phone's panel over the closed frame, opened the way a person opens it. */
async function openPanel(page: Page) {
  await page.setViewportSize({ width: 390, height: 844 })
  await installBackend(page)
  const streams = await installLiveStreams(page)
  await page.goto(SETTINGS)
  await expect.poll(() => streams.open()).toHaveLength(1)
  await streams.live(closedFrame())
  await page.locator('.nav-work-rail').click()
  const panel = page.getByRole('dialog', { name: 'Work' })
  await expect(panel).toBeVisible()
  await settled(panel)
  await page.mouse.move(0, 0)
}

test('at 390 a closed group head, a pinned closed epic and a closed item at work keep their lead column', async ({
  page,
}) => {
  await openPanel(page)
  const head = liveRow(page, 'MAIN-60', '.side-panel-body')
  await expect(head.locator('.nav-row-fold .nav-row-chevron')).toBeVisible()
  await expect(head.locator('.nav-row-lead')).toHaveCount(1)
  const epic = liveRow(page, 'MAIN-70', '.side-panel-body')
  await expect(epic.locator('.nav-row-lead')).toHaveCount(1)
  await expect(epic.locator('.nav-row-pin')).toBeVisible()
  const atWork = liveRow(page, 'MAIN-51', '.side-panel-body')
  await expect(atWork.locator('.nav-row-lead')).toHaveCount(1)
  await expect(atWork.locator('.nav-row-lead .work-dots')).toBeVisible()
})

/** Where a row's number stands across the panel. */
async function numberLeft(page: Page, reference: string) {
  const box = await liveRow(page, reference, '.side-panel-body')
    .locator('.nav-row-number')
    .boundingBox()
  if (box === null) throw new Error(`no number for ${reference}`)
  return box.x
}

/**
 * A closed item at the top level loses its lead; the same item nested under an epic or a group
 * keeps it, and its number stands one level-step right of its parent's, as the open items do.
 */
test('at 390 a closed top-level item has no lead, and nested closed items keep theirs one step in', async ({
  page,
}) => {
  await openPanel(page)
  await expect(liveRow(page, 'MAIN-7', '.side-panel-body').locator('.nav-row-lead')).toHaveCount(0)
  for (const reference of ['MAIN-50', 'MAIN-62']) {
    await expect(liveRow(page, reference, '.side-panel-body').locator('.nav-row-lead')).toHaveCount(
      1,
    )
  }
  // A level-two item under the epic stands one step right of the epic's number, as an open one does.
  const step = (await numberLeft(page, 'MAIN-9')) - (await numberLeft(page, 'MAIN-4'))
  const nested = (await numberLeft(page, 'MAIN-50')) - (await numberLeft(page, 'MAIN-4'))
  expect(Math.abs(nested - step)).toBeLessThanOrEqual(1)
  // A level-three item stands one step right of its level-two parent, as the open group's child does.
  const groupStep = (await numberLeft(page, 'MAIN-61')) - (await numberLeft(page, 'MAIN-60'))
  const grandchild = (await numberLeft(page, 'MAIN-62')) - (await numberLeft(page, 'MAIN-61'))
  expect(Math.abs(grandchild - groupStep)).toBeLessThanOrEqual(1)
})
