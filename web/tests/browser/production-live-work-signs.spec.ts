/**
 * Every sign of the list of work going on now is one box: the same width and height and the
 * same middle in the lead, so the signs stand in one column whatever the state, on the rail
 * at 1280 and in the phone's panel at 390. A turning sign is measured at rest, since a
 * square's bounds grow while it turns.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { busyFrame, liveRow } from '../support/liveFrame.ts'
import { installBackend } from './backend.ts'
import { settled } from './documentBeside.ts'
import { installLiveStreams, openFolds } from './liveWorkPage.ts'
import { globalScope } from './planningFixtures.ts'
import { test } from './test.ts'

const SETTINGS = serializePlatformRoute({ module_id: 'settings', scope: globalScope })

/** The busy frame, which has every live state, and a wait that asks a person. */
async function open(page: Page, width: number) {
  await page.setViewportSize({ width, height: 844 })
  await installBackend(page)
  const streams = await installLiveStreams(page)
  await page.goto(SETTINGS)
  await expect.poll(() => streams.open()).toHaveLength(1)
  const frame = busyFrame()
  frame.spaces[0].rows.push(
    liveRow('MAIN-32', { title: 'Asks a person', state: 'waiting', asks: true }),
  )
  await streams.live(frame)
}

/** Every sign in a list's leads, at rest: its box and its middle from the lead's corner. */
async function signBoxes(page: Page, within: string) {
  await openFolds(page, within)
  return page.locator(within).evaluate((root) =>
    [...root.querySelectorAll<SVGElement>('.nav-row-lead .session-sign')].map((sign) => {
      for (const animation of sign.getAnimations()) {
        animation.pause()
        animation.currentTime = 0
      }
      const lead = sign.closest('.nav-row-lead')?.getBoundingClientRect()
      const box = sign.getBoundingClientRect()
      return {
        sign: [...sign.classList].find((name) => name.startsWith('session-sign-')),
        width: box.width,
        height: box.height,
        x: box.left + box.width / 2 - (lead?.left ?? Number.NaN),
        y: box.top + box.height / 2 - (lead?.top ?? Number.NaN),
      }
    }),
  )
}

function expectOneBox(boxes: Awaited<ReturnType<typeof signBoxes>>) {
  expect(new Set(boxes.map((box) => box.sign))).toEqual(
    new Set(['working', 'asks', 'waiting', 'held', 'quiet'].map((sign) => `session-sign-${sign}`)),
  )
  for (const box of boxes) {
    expect([box.width, box.height], box.sign).toEqual([14, 14])
    expect(Math.abs(box.x - boxes[0].x), box.sign).toBeLessThanOrEqual(0.5)
    expect(Math.abs(box.y - boxes[0].y), box.sign).toBeLessThanOrEqual(0.5)
  }
}

test('every sign has one box and one middle in the rail’s leads, at 1280', async ({ page }) => {
  await open(page, 1280)
  const boxes = await signBoxes(page, '.nav-work-list')
  expect(boxes.length).toBeGreaterThanOrEqual(5)
  expectOneBox(boxes)
})

test('every sign has one box and one middle in the phone’s leads, at 390', async ({ page }) => {
  await open(page, 390)
  await page.locator('.nav-work-rail').click()
  await settled(page.getByRole('dialog', { name: 'Work' }))
  const boxes = await signBoxes(page, '.side-panel-body')
  expect(boxes.length).toBeGreaterThanOrEqual(5)
  expectOneBox(boxes)
})
