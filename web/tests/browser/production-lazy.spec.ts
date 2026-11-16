import { expect } from '@playwright/test'
import type { Page, Route, TestInfo } from '@playwright/test'

import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'
import { LOADING_DELAY_MS } from '@/shared/ui/loadingPresence.ts'

import { installBackend } from './backend.ts'
import { watchLoading } from './loadingWatch.ts'
import { spaceScope, workItem, workItemRef } from './planningFixtures.ts'
import { asked, installQuestions } from './questionBackend.ts'
import { test } from './test.ts'

/**
 * The code the board does not draw downloads when it is needed: the graph,
 * Settings, the card and the questions waiting for an answer. These are the states
 * that boundary can be in on a real page — not needed yet, downloading, slow,
 * failed and retried — read from the built bundle, because only the bundle has
 * chunks to delay or lose.
 */

const GRAPH_CHUNK = /\/assets\/GraphView-[\w-]+\.js$/
const SETTINGS_CHUNK = /\/assets\/SettingsView-[\w-]+\.js$/
const CARD_CHUNK = /\/assets\/WorkItemInspector-[\w-]+\.js$/
const QUESTIONS_CHUNK = /\/assets\/RequestList-[\w-]+\.js$/

function shot(info: TestInfo, name: string) {
  return { path: info.outputPath(name), animations: 'disabled' as const }
}

/** Every request for one chunk, in order, whatever the route did with it. */
function chunkRequests(page: Page, chunk: RegExp) {
  const seen: string[] = []
  page.on('request', (request) => {
    if (chunk.test(new URL(request.url()).pathname)) seen.push(request.url())
  })
  return seen
}

/** The board, with `prepare` adding routes of the test's own over the backend's. */
async function openBoard(page: Page, prepare?: () => Promise<unknown>) {
  await installBackend(page)
  await prepare?.()
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(serializePlatformRoute({ module_id: 'planning', scope: spaceScope }))
  await expect(page.locator('.work-item-tile').first()).toBeVisible()
}

/** Whether a loading or failure panel ever stood in the stage after this call. */
async function watchStagePanels(page: Page) {
  await page.evaluate(() => {
    const host = window as unknown as { stagePanelSeen?: boolean }
    host.stagePanelSeen = false
    new MutationObserver(() => {
      if (document.querySelector('.workspace-stage .platform-state-panel'))
        host.stagePanelSeen = true
    }).observe(document.body, { childList: true, subtree: true })
  })
  return () =>
    page.evaluate(() => (window as unknown as { stagePanelSeen?: boolean }).stagePanelSeen)
}

test('the board downloads neither the graph nor Settings, and reaching for either starts it', async ({
  page,
}) => {
  const graph = chunkRequests(page, GRAPH_CHUNK)
  const settings = chunkRequests(page, SETTINGS_CHUNK)
  await openBoard(page)
  expect(graph).toHaveLength(0)
  expect(settings).toHaveLength(0)

  await page.getByRole('button', { name: 'Settings', exact: true }).hover()
  await expect.poll(() => settings.length).toBe(1)

  const panelSeen = await watchStagePanels(page)
  // Awaited below, and started here: a response that arrives before anyone is
  // waiting for it is never reported, and the wait runs out the test's time.
  const downloaded = page.waitForResponse(GRAPH_CHUNK)
  await page.getByRole('radiogroup', { name: 'View', exact: true }).hover()
  await expect.poll(() => graph.length).toBe(1)
  await downloaded
  await page.getByRole('radio', { name: 'Graph', exact: true }).click()
  await expect(page.locator('.graph-canvas.settled')).toBeVisible()
  // Downloaded on intent, so the switch itself had nothing to wait for.
  expect(await panelSeen()).toBe(false)
  expect(graph).toHaveLength(1)
})

test('a slow graph download keeps the board until the loading panel takes its place', async ({
  page,
}, info) => {
  let held: Route | undefined
  await page.route(GRAPH_CHUNK, (route) => {
    held = route
  })
  await page.clock.install()
  await openBoard(page)
  const header = await page.locator('.workspace-head').boundingBox()

  // From here the page's time moves only when the test moves it: the board is
  // given its delay in one step, and no slow round trip can use it up first.
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1000)
  await page.getByRole('radio', { name: 'Graph', exact: true }).click()
  await expect.poll(() => held !== undefined).toBe(true)
  // The board stays on the stage for the whole of its delay.
  const tiles = page.locator('.work-item-tile')
  await expect(tiles.first()).toBeVisible()
  await page.clock.runFor(LOADING_DELAY_MS - 1)
  await expect(tiles.first()).toBeVisible()
  // The stage is never blank: when the board's delay runs out the loading panel takes
  // its place in the same step, with no time left to pass on the page's clock.
  await page.clock.runFor(1)
  const loading = page.locator('.workspace-stage [aria-busy="true"]')
  await expect(loading).toBeVisible()
  await expect(loading).toContainText('Loading')
  await expect(page.locator('.work-item-tile')).toHaveCount(0)
  expect(await page.locator('.workspace-head').boundingBox()).toEqual(header)
  await page.locator('.workspace').screenshot(shot(info, 'w-bundle-graph-loading.png'))

  await page.clock.resume()
  await held?.continue()
  await expect(page.locator('.graph-canvas.settled')).toBeVisible()
  await expect(loading).toHaveCount(0)
  expect(await page.locator('.workspace-head').boundingBox()).toEqual(header)
})

test('a failed graph download says so in the stage, and Retry downloads it again', async ({
  page,
}, info) => {
  const graph = chunkRequests(page, GRAPH_CHUNK)
  await page.route(GRAPH_CHUNK, (route) => route.abort('failed'))
  await openBoard(page)
  const header = await page.locator('.workspace-head').boundingBox()

  await page.getByRole('radio', { name: 'Graph', exact: true }).click()
  const failure = page.locator('.workspace-stage [role="alert"]')
  await expect(failure).toContainText('Could not load this view')
  await expect(failure).toContainText('This part of the interface did not download.')
  await expect(page.locator('.work-item-tile')).toHaveCount(0)
  expect(await page.locator('.workspace-head').boundingBox()).toEqual(header)
  await page.locator('.workspace').screenshot(shot(info, 'w-bundle-graph-failed.png'))

  const attempts = graph.length
  await page.unroute(GRAPH_CHUNK)
  await failure.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(page.locator('.graph-canvas.settled')).toBeVisible()
  await expect(failure).toHaveCount(0)
  // The browser asked again rather than replaying the failed module fetch.
  expect(graph.length).toBeGreaterThan(attempts)
})

const openTile = (page: Page) =>
  page.locator('.work-item-tile').filter({ hasText: workItemRef.reference }).first().click()

test('the board stands without the card or the questions, and the card downloads after it', async ({
  page,
}) => {
  const card = chunkRequests(page, CARD_CHUNK)
  const questions = chunkRequests(page, QUESTIONS_CHUNK)
  // The questions' code never arrives: nothing on the first screen may wait for it.
  await page.route(QUESTIONS_CHUNK, () => {})
  const downloaded = page.waitForResponse(CARD_CHUNK)
  await openBoard(page)
  await expect(page.locator('.workspace-stage .platform-state-panel')).toHaveCount(0)
  const header = await page.locator('.workspace-head').boundingBox()

  // Once the board stands, the card downloads with nobody waiting for it ...
  await downloaded
  expect(card).toHaveLength(1)
  expect(questions).toHaveLength(0)
  // ... so opening one has nothing to wait for.
  const watched = await watchLoading(page)
  await openTile(page)
  await expect(page.getByRole('heading', { name: workItem.title })).toBeVisible()
  await expect(page.locator('.drawer .platform-state-panel[aria-busy="true"]')).toHaveCount(0)
  const { spans } = await watched()
  expect(spans).toEqual([])
  expect(card).toHaveLength(1)
  expect(questions).toHaveLength(0)
  expect(await page.locator('.workspace-head').boundingBox()).toEqual(header)
})

/** The card's own read, which the backend answers once a test lets each request go on. */
const CARD_READ = '**/api/modules/planning/work-item?*'

/** Where an element stands inside the drawer, so the drawer sliding in moves nothing. */
async function placeInDrawer(page: Page, selector: string) {
  return page.locator(selector).evaluate((element) => {
    const box = element.getBoundingClientRect()
    const drawer = element.closest('.drawer')?.getBoundingClientRect()
    return {
      left: box.left - (drawer?.left ?? 0),
      top: box.top - (drawer?.top ?? 0),
      width: box.width,
    }
  })
}

interface DotsPlace {
  /** Drawn by the card's own wait for its record, rather than by the wait for its code. */
  card: boolean
  left: number
  top: number
}

/**
 * Runs in the page: from now on, note each place in the drawer where a wait's dots were
 * painted, on every mutation and every frame, so a place held for one frame is caught.
 * The dots' row is measured, not a dot, whose pulse lifts it by two pixels.
 */
async function watchDrawerDots(page: Page) {
  await page.evaluate(() => {
    const places: DotsPlace[] = []
    ;(window as unknown as { drawerDots?: DotsPlace[] }).drawerDots = places
    const sample = () => {
      for (const dots of document.querySelectorAll('.drawer [aria-busy="true"] .work-dots')) {
        if (!dots.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue
        const box = dots.getBoundingClientRect()
        const drawer = dots.closest('.drawer')?.getBoundingClientRect()
        const place = {
          card: dots.closest('.inspector-scope') !== null,
          left: Math.round((box.left - (drawer?.left ?? 0)) * 10) / 10,
          top: Math.round((box.top - (drawer?.top ?? 0)) * 10) / 10,
        }
        if (!places.some((seen) => JSON.stringify(seen) === JSON.stringify(place)))
          places.push(place)
      }
    }
    new MutationObserver(sample).observe(document, {
      attributes: true,
      childList: true,
      subtree: true,
    })
    const frame = () => {
      sample()
      requestAnimationFrame(frame)
    }
    requestAnimationFrame(frame)
  })
  return () =>
    page.evaluate(() =>
      structuredClone((window as unknown as { drawerDots?: DotsPlace[] }).drawerDots ?? []),
    )
}

// The card draws its frame from its first frame and waits for its record inside it, in
// the drawer's column. The wait for its code stood on the drawer's bare ground, a frame's
// inset to the left of that column, and jumped there when the card took over.
test('a card opened before its code arrives waits where the card will wait, then shows the card', async ({
  page,
}, info) => {
  let held: Route | undefined
  await page.route(CARD_CHUNK, (route) => {
    held = route
  })
  await openBoard(page)
  const reads: Route[] = []
  await page.route(CARD_READ, (route) => {
    reads.push(route)
  })
  const places = await watchDrawerDots(page)
  await openTile(page)

  const drawer = page.locator('.drawer')
  const loading = drawer.locator('[aria-busy="true"]')
  await expect(loading).toContainText('Loading')
  await expect(page.getByRole('heading', { name: workItem.title })).toHaveCount(0)
  await drawer.screenshot(shot(info, 'w-bundle-card-loading.png'))

  await expect.poll(() => held !== undefined).toBe(true)
  await held?.continue()
  // The card takes over and waits for its record in the same drawer.
  await expect(drawer.locator('.inspector-scope [aria-busy="true"]')).toContainText('Loading')
  await drawer.screenshot(shot(info, 'w-bundle-card-own-wait.png'))
  for (const read of reads) await read.fallback()
  await page.unroute(CARD_READ)
  await expect(page.getByRole('heading', { name: workItem.title })).toBeVisible()
  await expect(loading).toHaveCount(0)

  const seen = await places()
  const [own, ...more] = seen.filter((place) => place.card)
  const waits = seen.filter((place) => !place.card)
  expect(more).toEqual([])
  expect(waits.length).toBeGreaterThan(0)
  for (const wait of waits) {
    expect(Math.abs(wait.left - (own?.left ?? Number.NaN))).toBeLessThanOrEqual(1)
    expect(Math.abs(wait.top - (own?.top ?? Number.NaN))).toBeLessThanOrEqual(1)
  }
})

test('a card whose code fails to download says so where the card will wait, and Retry shows the card', async ({
  page,
}, info) => {
  const card = chunkRequests(page, CARD_CHUNK)
  await page.route(CARD_CHUNK, (route) => route.abort('failed'))
  await openBoard(page)
  const reads: Route[] = []
  await page.route(CARD_READ, (route) => {
    reads.push(route)
  })
  await openTile(page)

  const drawer = page.locator('.drawer')
  const failure = drawer.locator('[role="alert"]')
  await expect(failure).toContainText('Could not load this view')
  await drawer.screenshot(shot(info, 'w-bundle-card-failed.png'))
  const failed = await placeInDrawer(page, '.drawer [role="alert"]')

  const attempts = card.length
  await page.unroute(CARD_CHUNK)
  await failure.getByRole('button', { name: 'Retry', exact: true }).click()
  // The card's own wait for its record stands in the column the failure had to stand in.
  await expect(drawer.locator('.inspector-scope [aria-busy="true"]')).toContainText('Loading')
  const own = await placeInDrawer(page, '.drawer .inspector-scope [aria-busy="true"]')
  expect(Math.abs(failed.left - own.left)).toBeLessThanOrEqual(1)
  expect(Math.abs(failed.top - own.top)).toBeLessThanOrEqual(1)
  expect(Math.abs(failed.width - own.width)).toBeLessThanOrEqual(1)

  for (const read of reads) await read.fallback()
  await page.unroute(CARD_READ)
  await expect(page.getByRole('heading', { name: workItem.title })).toBeVisible()
  await expect(failure).toHaveCount(0)
  expect(card.length).toBeGreaterThan(attempts)
})

test('a card waiting for its code closes from its bar and with Escape', async ({ page }) => {
  await page.route(CARD_CHUNK, () => {})
  await openBoard(page)
  const drawer = page.locator('.drawer')
  const loading = drawer.locator('[aria-busy="true"]')

  await openTile(page)
  await expect(loading).toContainText('Loading')
  await drawer.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(drawer).toHaveCount(0)

  await openTile(page)
  await expect(loading).toContainText('Loading')
  await page.keyboard.press('Escape')
  await expect(drawer).toHaveCount(0)
})

test('the questions opened before their code arrives say so in the dialog, then show', async ({
  page,
}, info) => {
  let held: Route | undefined
  await page.route(QUESTIONS_CHUNK, (route) => {
    held = route
  })
  await openBoard(page, () => installQuestions(page, [asked()]))
  await page.getByRole('button', { name: /^Needs my answer/u }).click()

  const dialog = page.getByRole('dialog', { name: 'Needs my answer', exact: true })
  const loading = dialog.locator('[aria-busy="true"]')
  await expect(loading).toContainText('Loading')
  await expect(dialog.locator('.request-card')).toHaveCount(0)
  await dialog.screenshot(shot(info, 'w-bundle-questions-loading.png'))

  await expect.poll(() => held !== undefined).toBe(true)
  await held?.continue()
  await expect(dialog.locator('.request-card').first()).toBeVisible()
  await expect(dialog.locator('.platform-state-panel')).toHaveCount(0)
})

test('a link to Settings whose code fails to download offers Retry in the module frame', async ({
  page,
}, info) => {
  let held: Route | undefined
  await page.route(SETTINGS_CHUNK, (route) => {
    held = route
  })
  await installBackend(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(serializePlatformRoute({ module_id: 'settings', scope: spaceScope }))

  const loading = page.locator('.module-frame [aria-busy="true"]')
  await expect(loading).toContainText('Loading')
  await page.locator('.module-frame').screenshot(shot(info, 'w-bundle-settings-loading.png'))

  await held?.abort('failed')
  const failure = page.locator('.module-frame [role="alert"]')
  await expect(failure).toContainText('Could not load this view')
  await expect(loading).toHaveCount(0)
  await page.locator('.module-frame').screenshot(shot(info, 'w-bundle-settings-failed.png'))

  await page.unroute(SETTINGS_CHUNK)
  await failure.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(page.locator('.settings-page')).toBeVisible()
  await expect(failure).toHaveCount(0)
})
