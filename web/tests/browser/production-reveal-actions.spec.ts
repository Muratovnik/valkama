/**
 * The actions a row keeps out of sight until it is wanted (`reveal.css`), in the built app, in
 * both languages, at 1280 and 390, where a pointer can hover and where only a finger presses:
 * a checklist step's discussion, the pin of an unpinned rail row, a rail row's «Open session»
 * and a lane heading's card and chain.
 *
 * Where a pointer can hover, each is out of sight at rest and keeps its place there: the row and
 * its text stand where they stood once it comes up, measured, not looked at. A rail row's «Open
 * session» is the one that gives its room up at rest: the row stands where it stood and the text
 * starts where it started, only narrower once it comes up. It comes up under the pointer and
 * with the keyboard on it, reached by Tab from either side. Where nothing can hover it stands at
 * rest. A pinned row's pin is the pin's mark, so it stands everywhere.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { planningWorkItemEntity } from '@/shared/api/platformPlanningRefs.ts'
import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { busyFrame, liveSession } from '../support/liveFrame.ts'
import { installBackend } from './backend.ts'
import { openBoard, serve } from './boardPage.ts'
import { settled } from './documentBeside.ts'
import { installLiveStreams, liveRow } from './liveWorkPage.ts'
import { globalScope, projectScope, workItem, workItemRef } from './planningFixtures.ts'
import { test } from './test.ts'

const CARD = serializePlatformRoute({
  module_id: 'planning',
  scope: projectScope,
  entity: planningWorkItemEntity(workItemRef),
})
const SETTINGS = serializePlatformRoute({ module_id: 'settings', scope: globalScope })

const steps = ['123e4567-e89b-42d3-a456-426614174201', '123e4567-e89b-42d3-a456-426614174202'].map(
  (id, at) => ({
    id,
    text: at === 0 ? 'A step to talk over' : 'The step after it',
    done: false,
    claimed_by: '',
    done_by: '',
  }),
)

/** One host as the spec reads it: the row, the text in it, the action and how to reach it. */
interface Host {
  /** The action out of sight at rest, or the group of them. */
  action: Locator
  /** The focus stop just before the action, in the same row. */
  before: Locator
  /** The control the keyboard lands on when it reaches the action. */
  first: Locator
  row: Locator
  text: Locator
  /** Whether the action gives its room up at rest, so the text narrows when it comes up. */
  room?: boolean
}

async function stepHost(page: Page, width: number): Promise<Host> {
  await page.setViewportSize({ width, height: 900 })
  await installBackend(page)
  await page.route('**/api/modules/planning/work-item?*', (route) =>
    route.fulfill({
      json: {
        interface_version: 'valkama-planning-work-item',
        scope: projectScope,
        work_item_ref: workItemRef,
        state: {
          interface_version: 'valkama-ui-state',
          status: 'ready',
          payload: { work_item: { ...workItem, checklist: steps } },
        },
      },
    }),
  )
  await page.goto(CARD)
  const row = page.locator('.step-row').first()
  await expect(row.locator('.step-discuss')).toHaveCount(1)
  return {
    row,
    text: row.locator('.step-text'),
    action: row.locator('.step-discuss'),
    first: row.locator('.step-discuss'),
    before: row.locator('.step'),
  }
}

/** The busy frame with a session behind MAIN-12, which its «Open session» opens. */
function withSession() {
  const frame = busyFrame()
  const row = frame.spaces[0].rows.find((each) => each.reference === 'MAIN-12')
  if (row) row.executor = liveSession('00000000-0000-4000-8000-000000000201').executor
  return frame
}

async function openRail(page: Page, width: number, frame = busyFrame()) {
  await page.setViewportSize({ width, height: 844 })
  await installBackend(page)
  const streams = await installLiveStreams(page)
  await page.goto(SETTINGS)
  await expect.poll(() => streams.open()).toHaveLength(1)
  await streams.live(frame)
  if (width > 760) return '.nav-work-list'
  await page.locator('.nav-work-rail').click()
  await settled(page.getByRole('dialog', { name: /Work|Работа/u }))
  return '.side-panel-body'
}

async function pinHost(page: Page, width: number): Promise<Host> {
  await openRail(page, width)
  const row = liveRow(page, 'MAIN-12')
  await expect(row).toBeVisible()
  return {
    row,
    text: row.locator('.nav-row-title'),
    action: row.locator('.nav-row-pin'),
    first: row.locator('.nav-row-pin'),
    before: row.locator('.nav-row-link'),
  }
}

async function sessionHost(page: Page, width: number): Promise<Host> {
  const within = await openRail(page, width, withSession())
  const row = liveRow(page, 'MAIN-12', within)
  await expect(row.locator('.nav-row-open')).toHaveCount(1)
  return {
    row,
    text: row.locator('.nav-row-title'),
    action: row.locator('.nav-row-open'),
    first: row.locator('.nav-row-open'),
    before: row.locator('.nav-row-link'),
    room: width > 760,
  }
}

async function laneHost(page: Page, width: number): Promise<Host> {
  await page.setViewportSize({ width, height: 900 })
  await installBackend(page)
  await serve(page)
  await openBoard(page)
  const row = page.locator('.lane-head', { has: page.locator('.lane-actions') }).first()
  return {
    row,
    text: row.locator('.lane-title'),
    action: row.locator('.lane-actions'),
    first: row.locator('.lane-actions button').first(),
    before: row.locator('.lane-toggle'),
  }
}

const HOSTS = { step: stepHost, pin: pinHost, session: sessionHost, lane: laneHost } as const

/** How much of the action is drawn: its own opacity times every ancestor's, nothing if hidden. */
const sight = (action: Locator) =>
  action.evaluate((node) => {
    if (getComputedStyle(node).visibility !== 'visible') return 0
    let shown = 1
    for (let at: Element | null = node; at; at = at.parentElement)
      shown *= Number(getComputedStyle(at).opacity)
    return shown
  })

/** Where the row and its text stand, and the room the action keeps. */
const box = (part: Locator) =>
  part.evaluate((node) => {
    const { x, y, width, height } = node.getBoundingClientRect()
    return { x, y, width, height }
  })

async function place(host: Host) {
  return { row: await box(host.row), text: await box(host.text), action: await box(host.action) }
}

/** What stays put when the action comes up: all of it, or the row and where its text starts. */
function fixed(host: Host, { row, text, action }: Awaited<ReturnType<typeof place>>) {
  return host.room
    ? { row, text: { x: text.x, y: text.y, height: text.height } }
    : { row, text, action }
}

const away = (page: Page) => page.mouse.move(1, 1)

/**
 * Once nothing on the page is on its way anywhere: a drawer slides in, and a row measured on the
 * way is not at rest. A sign that runs for as long as its work does never ends, and moves nothing.
 */
const still = (page: Page) =>
  page.waitForFunction(() =>
    document
      .getAnimations()
      .every(
        (motion) =>
          motion.playState !== 'running' ||
          motion.effect?.getComputedTiming().endTime === Number.POSITIVE_INFINITY,
      ),
  )

for (const locale of ['en-US', 'ru-RU']) {
  test.describe(`${locale}, where a pointer can hover`, () => {
    test.use({ locale })

    for (const width of [1280, 390])
      for (const [name, open] of Object.entries(HOSTS)) {
        // On a phone-wide window the rail's list is a panel that holds only pinned rows' pins.
        if (name === 'pin' && width <= 760) continue

        test(`${name} at ${width}: out of sight at rest in its own place, up under the pointer and the keyboard`, async ({
          page,
        }) => {
          const host = await open(page, width)
          await page.evaluate(() => document.fonts.ready)
          await away(page)
          await expect.poll(() => sight(host.action)).toBe(0)
          await still(page)
          const rest = await place(host)
          expect(
            rest.action.width > 0,
            'the action keeps its room at rest unless it gives it up',
          ).toBe(!host.room)

          await host.text.hover()
          await expect.poll(() => sight(host.action)).toBe(1)
          const hovered = await place(host)
          test.info().annotations.push({
            type: 'measured',
            description: JSON.stringify({ rest, hovered }),
          })
          expect(fixed(host, hovered), 'nothing moves when it comes up').toEqual(fixed(host, rest))
          expect(hovered.text.width < rest.text.width, 'only text beside a room narrows').toBe(
            host.room === true,
          )

          await away(page)
          await expect.poll(() => sight(host.action)).toBe(0)

          // From the row's stop before it, Tab lands on it and brings it up.
          await host.before.focus()
          await page.keyboard.press('Tab')
          await expect(host.first).toBeFocused()
          await expect.poll(() => sight(host.action)).toBe(1)
          expect(await place(host)).toEqual(hovered)

          // From the stop after it, Shift+Tab comes back to it: out of sight is still a stop.
          await page.keyboard.press('Tab')
          await expect(host.first).not.toBeFocused()
          await page.keyboard.press('Shift+Tab')
          await expect(host.first).toBeFocused()
          await expect.poll(() => sight(host.action)).toBe(1)
        })
      }

    for (const width of [1280, 390])
      test(`a pinned row's pin stands at rest at ${width}`, async ({ page }) => {
        const within = await openRail(page, width)
        await away(page)
        await expect
          .poll(() => sight(liveRow(page, 'MAIN-20', within).locator('.nav-row-pin')))
          .toBe(1)
      })

    test('at 390 the panel holds no pin on an unpinned row', async ({ page }) => {
      const within = await openRail(page, 390)
      await expect(liveRow(page, 'MAIN-12', within)).toBeVisible()
      await expect(liveRow(page, 'MAIN-12', within).locator('.nav-row-pin')).toHaveCount(0)
    })
  })

  test.describe(`${locale}, where only a finger presses`, () => {
    test.use({ locale, hasTouch: true, isMobile: true })

    for (const width of [1280, 390])
      for (const [name, open] of Object.entries(HOSTS)) {
        if (name === 'pin' && width <= 760) continue

        test(`${name} at ${width}: stands at rest`, async ({ page }) => {
          const host = await open(page, width)
          await expect
            .poll(() => page.evaluate(() => matchMedia('(hover: none)').matches))
            .toBe(true)
          await expect.poll(() => sight(host.action)).toBe(1)
          await expect(host.first).toBeVisible()
        })
      }
  })
}
