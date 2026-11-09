/**
 * Settings stands in the rail's foot, at its floor, wherever the list of work going on now
 * ends: under an empty list and under one long enough to scroll it stands at the same place,
 * inside the navigation landmark, at the default width, at the narrowest the reader can
 * choose and on a phone's icon rail.
 *
 * It stood under the last group, so a long list carried it down into the rail and a short
 * one left it half way up.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'
import {
  NAV_DEFAULT_WIDTH,
  NAV_MIN_WIDTH,
  NAV_WIDTH_STORAGE_KEY,
} from '@/shared/lib/shellLayout.ts'

import { liveFrame, liveRow, liveSpace } from '../support/liveFrame.ts'
import { installBackend } from './backend.ts'
import { installLiveStreams } from './liveWorkPage.ts'
import { globalScope } from './planningFixtures.ts'
import { test } from './test.ts'

const SETTINGS = serializePlatformRoute({ module_id: 'settings', scope: globalScope })

/** Forty items at work: more than any rail holds, so the list scrolls. */
const longFrame = () =>
  liveFrame([
    liveSpace(
      'MAIN',
      Array.from({ length: 40 }, (_, index) => liveRow(`MAIN-${index + 1}`, { state: 'working' })),
    ),
  ])

const settingsBox = (page: Page) =>
  page.locator('.nav-item.module-settings').evaluate((node) => {
    const rail = node.closest('.app-nav-shell')?.getBoundingClientRect()
    const box = node.getBoundingClientRect()
    return { x: box.x, y: box.y, bottom: box.bottom, floor: rail?.bottom ?? Number.NaN }
  })

/** Each width as the reader chose it, and the width the rail then stands at. */
const widths = [
  { name: 'at 1280', viewport: { width: 1280, height: 800 }, chosen: NAV_DEFAULT_WIDTH, rail: 260 },
  {
    name: 'at the narrowest rail',
    viewport: { width: 1280, height: 800 },
    chosen: NAV_MIN_WIDTH,
    rail: 200,
  },
  { name: 'at 390', viewport: { width: 390, height: 844 }, chosen: NAV_DEFAULT_WIDTH, rail: 64 },
] as const

for (const { name, viewport, chosen, rail } of widths) {
  test(`Settings stands in the foot at the rail's floor whatever the list holds, ${name}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport)
    await page.addInitScript(([key, width]) => localStorage.setItem(key, width), [
      NAV_WIDTH_STORAGE_KEY,
      String(chosen),
    ] as const)
    await installBackend(page)
    const streams = await installLiveStreams(page)
    await page.goto(SETTINGS)
    await expect.poll(() => streams.open()).toHaveLength(1)
    expect(
      await page.locator('.app-nav-shell').evaluate((node) => node.getBoundingClientRect().width),
    ).toBe(rail)

    const settings = page.getByRole('navigation').locator('.nav-item.module-settings')
    await expect(settings).toHaveCount(1)

    await streams.live(liveFrame([]))
    const empty = await settingsBox(page)
    await streams.live(longFrame())
    await expect(page.locator('.nav-row').first()).toBeAttached()
    const long = await settingsBox(page)

    // At the floor: under it only the foot's own padding, the same under either list.
    expect(empty.floor - empty.bottom, `${name}: ${JSON.stringify(empty)}`).toBeLessThanOrEqual(24)
    expect(long, `${name}: empty ${JSON.stringify(empty)}`).toEqual(empty)
    // In the foot, beside the connection's state.
    await expect(page.locator('.nav-utility .nav-item.module-settings')).toBeVisible()
  })
}
