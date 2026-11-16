/**
 * The rail at its narrowest, from the Settings page, holding a row whose title it cuts among the
 * live work: the page the specs of a cut row's whole words and of its hint beside the rail read.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { busyFrame, liveRow as frameRow } from '../support/liveFrame.ts'
import { installBackend } from './backend.ts'
import { pass } from './hintFramesPage.ts'
import { installLiveStreams } from './liveWorkPage.ts'
import { globalScope } from './planningFixtures.ts'

const SETTINGS = serializePlatformRoute({ module_id: 'settings', scope: globalScope })
/** Cut by the rail at its narrowest, and whole at its widest. */
const LONG_TITLE = 'An item whose title runs past the rail at its narrowest'

/** The rail at its narrowest, holding a row whose title it cuts, from the Settings page. */
export async function openRail(page: Page, width: number) {
  await page.setViewportSize({ width, height: 800 })
  await installBackend(page)
  const streams = await installLiveStreams(page)
  await page.goto(SETTINGS)
  await expect.poll(() => streams.open()).toHaveLength(1)
  const frame = busyFrame()
  frame.spaces.push({
    key: 'LONG',
    name: 'Long',
    project_id: 'example-project',
    rows: [frameRow('LONG-1', { title: LONG_TITLE, state: 'working' })],
    sessions: [],
  })
  await streams.live(frame)
  const edge = page.getByRole('separator', { name: 'Navigation width' })
  await edge.focus()
  await page.keyboard.press('Home')
  await edge.blur()
  const row = page.locator('.nav-row', { has: page.locator('[aria-label^="LONG-1 "]') })
  // The rail's list scrolls under its modules, which stand over the rows at its foot.
  await row.scrollIntoViewIfNeeded()
  await pass(page, 300)
  await expect(row).toBeVisible()
  return { edge, row, title: row.locator('.nav-row-title') }
}
