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
