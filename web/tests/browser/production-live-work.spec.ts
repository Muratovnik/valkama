/**
 * The rail's list of work going on now, in the built app: one stream per tab wherever
 * the reader is, a row that opens its card in its own space with the view kept, the
 * row on show, the pin, and the disclosure keys.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { planningWorkItemEntity } from '@/shared/api/platformPlanningRefs.ts'
import { parsePlatformRoute, serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { busyFrame, liveRow as frameRow, liveFrame } from '../support/liveFrame.ts'
import { installBackend } from './backend.ts'
import { installLiveStreams, liveRow, servePins } from './liveWorkPage.ts'
import { globalScope, projectScope, workItemRef } from './planningFixtures.ts'
import { test } from './test.ts'
import { firstProject, serveTwoProjects } from './twoProjects.ts'

const SETTINGS = serializePlatformRoute({ module_id: 'settings', scope: globalScope })
const PORTFOLIO = serializePlatformRoute({ module_id: 'planning', scope: globalScope })

/** The busy frame with the fixture's own card among the rows. */
function frameWithCard() {
  const frame = busyFrame()
  frame.spaces[0].rows.push(frameRow(workItemRef.reference, { state: 'working', title: 'Card' }))
  return frame
}

async function shown(page: Page, streams: Awaited<ReturnType<typeof installLiveStreams>>) {
  await expect(page.locator('.app-nav-shell')).toBeVisible()
  await expect.poll(() => streams.open()).toHaveLength(1)
  await streams.live(busyFrame())
  await expect(liveRow(page, 'MAIN-12')).toBeVisible()
}

test.describe('one stream for the tab', () => {
  for (const [where, address, view] of [
    ['a space page', firstProject(), 'planning'],
    ['Settings', SETTINGS, 'live'],
    ['the portfolio', PORTFOLIO, 'live'],
  ] as const)
    test(`holds exactly one EventSource on ${where}, and the list reads from it`, async ({
      page,
    }) => {
      await installBackend(page)
      const streams = await installLiveStreams(page)
      await page.goto(address)
      await shown(page, streams)
      const [open] = await streams.open()
      expect(new URL(open, 'http://127.0.0.1').searchParams.get('view')).toBe(view)
      // Not one opened and closed again while the shell made up its mind.
      expect(await streams.made()).toEqual([open])
    })

  test('hands the frame from the space stream to the live view and back with one open', async ({
    page,
  }) => {
    await installBackend(page)
    const streams = await installLiveStreams(page)
    await page.goto(firstProject())
    await shown(page, streams)
    await page.locator('.nav-item.module-settings').click()
    await expect(page).toHaveURL(/\/modules\/settings\//u)
    await expect.poll(() => streams.open()).toEqual(['/api/events?view=live'])
    // The list stays drawn across the change of stream.
    await expect(liveRow(page, 'MAIN-12')).toBeVisible()
    await page.locator('.nav-item.module-planning').click()
    await expect.poll(() => streams.open()).toEqual([expect.stringContaining('view=planning')])
  })
})

test('a row of another space opens its card there and keeps the view', async ({ page }) => {
  await serveTwoProjects(page)
  const streams = await installLiveStreams(page)
  await page.goto(firstProject({ view: 'list' }))
  await expect(page.locator('.work-item-list')).toBeVisible()
  await shown(page, streams)
  await liveRow(page, 'NEXT-5').locator('.nav-row-link').click()
  await expect(page).toHaveURL(/\/modules\/planning\/project\/second-project\?/u)
  const route = parsePlatformRoute(new URL(page.url()).pathname + new URL(page.url()).search)
  expect(route.state).toEqual({ view: 'list' })
  expect(route.entity?.kind).toBe('work-item')
  await expect(liveRow(page, 'NEXT-5').locator('.nav-row-link')).toHaveAttribute(
    'aria-current',
    'page',
  )
})

test('marks the open card’s row as the page, and the entry it stands under as the place', async ({
  page,
}) => {
  await installBackend(page)
  const streams = await installLiveStreams(page)
  await page.goto(
    serializePlatformRoute({
      module_id: 'planning',
      scope: projectScope,
      entity: planningWorkItemEntity(workItemRef),
    }),
  )
  await expect(page.locator('.drawer')).toBeVisible()
  await streams.live(frameWithCard())
  const row = liveRow(page, workItemRef.reference).locator('.nav-row-link')
  await expect(row).toHaveAttribute('aria-current', 'page')
  await expect(page.locator('nav [aria-current="page"]')).toHaveCount(1)
  await expect(page.locator('.nav-item.module-planning')).toHaveAttribute('aria-current', 'true')
})

test('pins from a row under the pointer, and the pinned row keeps its pin in sight', async ({
  page,
}) => {
  await installBackend(page)
  const streams = await installLiveStreams(page)
  const sent = await servePins(page, () => {
    const frame = busyFrame()
    const at = frame.spaces[0].rows.findIndex((row) => row.reference === 'MAIN-12')
    frame.spaces[0].rows[at] = { ...frame.spaces[0].rows[at], pinned: true }
    return frame
  })
  await page.goto(SETTINGS)
  await shown(page, streams)
  const row = liveRow(page, 'MAIN-12')
  const pin = row.locator('.nav-row-pin')
  await expect(pin).toBeHidden()
  await row.hover()
  await expect(pin).toBeVisible()
  await expect(pin).toHaveAccessibleName('Pin to Work')
  await pin.click()
  await expect.poll(() => sent).toEqual([{ id: 'MAIN-12', pinned: true }])
  await page.mouse.move(900, 600)
  await expect(pin).toBeVisible()
  await expect(pin).toHaveAccessibleName('Pinned to Work: press to remove the pin')
})

test('the disclosure keys: Tab reaches folds and links, Enter and Space fold, Escape folds back', async ({
  page,
}) => {
  await installBackend(page)
  const streams = await installLiveStreams(page)
  await page.goto(SETTINGS)
  await shown(page, streams)
  const workFold = page.locator('.nav-entry-fold')
  await workFold.focus()
  await page.keyboard.press('Tab')
  const spaceFold = page.locator('.nav-tree-fold').first()
  await expect(spaceFold).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(page.locator('.nav-tree-space-link').first()).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await page.keyboard.press('Enter')
  await expect(spaceFold).toHaveAttribute('aria-expanded', 'false')
  await expect(liveRow(page, 'MAIN-12')).toBeHidden()
  await page.keyboard.press('Space')
  await expect(spaceFold).toHaveAttribute('aria-expanded', 'true')
  await liveRow(page, 'MAIN-12').locator('.nav-row-link').focus()
  await page.keyboard.press('Escape')
  const epicFold = liveRow(page, 'MAIN-4').locator('.nav-row-fold')
  await expect(epicFold).toBeFocused()
  await expect(epicFold).toHaveAttribute('aria-expanded', 'false')
  // A keyboard fold rings, as focus moved by the interface for a key does.
  expect(await epicFold.evaluate((node) => node.matches(':focus-visible'))).toBe(true)
})

test('says nobody is working when the frame is empty, in the room a row takes', async ({
  page,
}) => {
  await installBackend(page)
  const streams = await installLiveStreams(page)
  await page.goto(SETTINGS)
  await expect.poll(() => streams.open()).toHaveLength(1)
  await streams.live(liveFrame([]))
  await expect(page.locator('.nav-work-list')).toHaveText('Nobody is working right now')
})
