/**
 * The branch map's tip names the task the pointer is on whole, in the built app. It follows the
 * pointer and can be neither hovered nor focused, so a title it cut to two lines could never be
 * read whole there. Whether it stands above the lane or under it is decided by its own height, so
 * a title of several lines stays inside the map and the window near the map's top and its bottom.
 */
import { expect } from '@playwright/test'
import type { Locator } from '@playwright/test'

import { branchedChain } from '../fixtures/chainMap.ts'
import { installBackend } from './backend.ts'
import { openChainCard, retitledChain, serve } from './chainFixtures.ts'
import { workItem, workItemRef } from './planningFixtures.ts'
import { test } from './test.ts'

const root = { id: workItem.work_item_id, reference: workItemRef.reference, title: workItem.title }

/**
 * Far longer than the two lines the tip once cut a title to, at the tip's width, and within the
 * 200 characters a chain's title is held to.
 */
const TIP_TITLE =
  'Read an attached planning store that an older build wrote without migrating it, name every scope the read had to skip instead of dropping it, and say which of them a newer build can still open'

/**
 * Scrolls the card's panel so `lane`'s target stands `below` px under the panel's top edge, or
 * with `below` negative its bottom that far over the panel's bottom edge, and returns the
 * panel's box: the frame the map is read in.
 */
function scrollLane(lane: Locator, below: number) {
  return lane.evaluate((element, offset) => {
    let panel = element.parentElement
    while (panel && !/auto|scroll/u.test(getComputedStyle(panel).overflowY))
      panel = panel.parentElement
    if (!panel) throw new Error('no panel scrolls the map')
    const box = element.getBoundingClientRect()
    const edge = panel.getBoundingClientRect()
    panel.scrollTop += offset >= 0 ? box.top - edge.top - offset : box.bottom - edge.bottom - offset
    const { top, bottom, left, right } = panel.getBoundingClientRect()
    return { top, bottom, left, right }
  }, below)
}

/** What the tip shows of its title, and where it stands against the map and the window. */
function tipReading(tip: Locator) {
  return tip.evaluate((element) => {
    const title = element.querySelector<HTMLElement>('.branch-tip-title')
    const map = element.closest('.branch-map')?.getBoundingClientRect()
    if (!title || !map) throw new Error('no title in the tip, or no map around it')
    const range = document.createRange()
    range.selectNodeContents(title)
    const lines = [...range.getClientRects()].filter((line) => line.width > 0)
    const own = title.getBoundingClientRect()
    const last = lines.at(-1)
    const { bottom, height, left, right, top } = element.getBoundingClientRect()
    return {
      box: { bottom, height, left, right, top },
      // A clamp hides the lines past its last under the box, and ends the last it shows in an
      // ellipsis: every line laid out is inside the title's box, its last word too.
      cut:
        title.scrollHeight > title.clientHeight + 1 ||
        !last ||
        last.bottom > own.bottom + 0.5 ||
        last.right > own.right + 0.5,
      lines: lines.length,
      map: { bottom: map.bottom, left: map.left, right: map.right, top: map.top },
      window: { width: window.innerWidth, height: window.innerHeight },
    }
  })
}

/** The tip names `TIP_TITLE` whole, inside the map, the panel it is read in and the window. */
async function expectWholeTip(tip: Locator, frame: { bottom: number; top: number }) {
  await expect(tip).toBeVisible()
  await expect(tip.locator('.branch-tip-title')).toHaveText(TIP_TITLE)
  const reading = await tipReading(tip)
  expect(reading.cut, 'the title is cut').toBe(false)
  expect(reading.lines, 'the title runs past two lines').toBeGreaterThan(2)
  const { box, map } = reading
  expect(box.left, 'the tip past the map').toBeGreaterThanOrEqual(map.left - 0.5)
  expect(box.right, 'the tip past the map').toBeLessThanOrEqual(map.right + 0.5)
  expect(box.top, 'the tip over the top').toBeGreaterThanOrEqual(Math.max(frame.top, map.top) - 0.5)
  const floor = Math.min(frame.bottom, map.bottom, reading.window.height)
  expect(box.bottom, 'the tip under the bottom').toBeLessThanOrEqual(floor + 0.5)
  return reading
}

test('the tip names a long title whole, inside the map and the window, near its top and its bottom', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await installBackend(page)
  await serve(page, retitledChain(branchedChain(root, 'MAIN'), TIP_TITLE))
  const section = await openChainCard(page)
  const lanes = section.getByRole('slider')
  const tip = section.locator('.branch-tip')
  // Hovering waits for the card to finish sliding in; the tip it shows says how tall it is.
  await lanes.first().hover()
  await expect(tip).toBeVisible()
  const shown = await tip.boundingBox()
  const tall = shown?.height ?? 0
  await page.mouse.move(0, 0)
  await expect(tip).toHaveCount(0)

  // Near the top: the first lane lower than a tip of two lines needs room above it, and higher
  // than this one does, so it stands under the lane.
  const top = await scrollLane(lanes.first(), tall - 10)
  const first = (await lanes.first().boundingBox()) ?? { x: 0, y: 0, width: 0, height: 0 }
  await lanes.first().hover({ position: { x: 200, y: first.height / 2 } })
  const near = await expectWholeTip(tip, top)
  expect(near.box.height + 4, 'no room above the lane').toBeGreaterThan(first.y - top.top)
  expect(near.box.top).toBeGreaterThan(first.y)
  await page.mouse.move(0, 0)
  await expect(tip).toHaveCount(0)

  // Near the bottom: the last lane at the panel's bottom edge, the tip above it.
  const bottom = await scrollLane(lanes.last(), -4)
  const last = (await lanes.last().boundingBox()) ?? { x: 0, y: 0, width: 0, height: 0 }
  // Its label stands at its start: the pointer rests on its far half.
  await lanes.last().hover({ position: { x: last.width * 0.75, y: last.height / 2 } })
  const far = await expectWholeTip(tip, bottom)
  expect(far.box.bottom).toBeLessThan(last.y + last.height)
})
