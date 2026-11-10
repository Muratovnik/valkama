/**
 * The phone's list of work going on now with closed rows in it: a closed item a session is
 * still on keeps its lead column, since its sign stands there; a closed item with no sign, a
 * pinned closed epic among them, has no lead (`NavWorkRow`). A closed item that is in the
 * frame only as the parent of others is no row at all: its title is said with its items' rows,
 * on the second line of a row to follow now and before the title of a row in a fold.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { closedFrame } from '../support/liveFrame.ts'
import { installBackend } from './backend.ts'
import { settled } from './documentBeside.ts'
import { installLiveStreams, liveRow, openFolds } from './liveWorkPage.ts'
import { globalScope } from './planningFixtures.ts'
import { test } from './test.ts'

const SETTINGS = serializePlatformRoute({ module_id: 'settings', scope: globalScope })
const PANEL = '.side-panel-body'

/** The phone's panel over the closed frame, opened the way a person opens it, every fold too. */
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
  await openFolds(page, PANEL)
}

test('at 390 a closed item at work keeps its lead column, and a closed one with no sign has none', async ({
  page,
}) => {
  await openPanel(page)
  const atWork = liveRow(page, 'MAIN-51', PANEL)
  await expect(atWork.locator('.nav-row-lead')).toHaveCount(1)
  await expect(atWork.locator('.nav-row-lead .session-sign')).toBeVisible()
  for (const reference of ['MAIN-7', 'MAIN-70']) {
    const closed = liveRow(page, reference, PANEL)
    await expect(closed.locator('.nav-row-lead'), reference).toHaveCount(0)
    await expect(closed.locator('.nav-row-pin'), reference).toBeVisible()
  }
})

test('at 390 a closed parent is no row: its title is said with the rows of its items', async ({
  page,
}) => {
  await openPanel(page)
  for (const reference of ['MAIN-50', 'MAIN-60', 'MAIN-62'])
    await expect(liveRow(page, reference, PANEL), reference).toHaveCount(0)
  await expect(liveRow(page, 'MAIN-61', PANEL).locator('.nav-row-epic')).toHaveText(
    'Closed group with children',
  )
  // A pinned closed epic is a row of its pinned group, and its item, which waits, says it on
  // its second line.
  const waiting = liveRow(page, 'MAIN-71', PANEL)
  await expect(waiting.locator('.nav-row-detail')).toContainText('Pinned closed epic')
  await expect(waiting.locator('.nav-row-epic')).toHaveCount(0)
})
