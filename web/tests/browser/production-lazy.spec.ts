import { expect } from '@playwright/test'
import type { Page, Route, TestInfo } from '@playwright/test'

import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { installBackend } from './backend.ts'
import { projectScope } from './planningFixtures.ts'
import { test } from './test.ts'

/**
 * The code the board does not draw downloads when it is needed: the graph and
 * Settings. These are the states that boundary can be in on a real page — not
 * needed yet, downloading, slow, failed and retried — read from the built
 * bundle, because only the bundle has chunks to delay or lose.
 */

const GRAPH_CHUNK = /\/assets\/GraphView-[\w-]+\.js$/
const SETTINGS_CHUNK = /\/assets\/SettingsView-[\w-]+\.js$/

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

async function openBoard(page: Page) {
  await installBackend(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(serializePlatformRoute({ module_id: 'planning', scope: projectScope }))
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
  await page.getByRole('group', { name: 'View', exact: true }).hover()
  await expect.poll(() => graph.length).toBe(1)
  await page.waitForResponse(GRAPH_CHUNK)
  await page.getByRole('button', { name: 'Graph', exact: true }).click()
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
  await openBoard(page)
  const header = await page.locator('.workspace-head').boundingBox()

  await page.getByRole('button', { name: 'Graph', exact: true }).click()
  await expect.poll(() => held !== undefined).toBe(true)
  // The stage is never blank: the board stays until the panel replaces it.
  await expect(page.locator('.work-item-tile').first()).toBeVisible()
  const loading = page.locator('.workspace-stage [aria-busy="true"]')
  await expect(loading).toBeVisible()
  await expect(loading).toContainText('Loading')
  await expect(page.locator('.work-item-tile')).toHaveCount(0)
  expect(await page.locator('.workspace-head').boundingBox()).toEqual(header)
  await page.locator('.workspace').screenshot(shot(info, 'w-bundle-graph-loading.png'))

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

  await page.getByRole('button', { name: 'Graph', exact: true }).click()
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

test('a link to Settings whose code fails to download offers Retry in the module frame', async ({
  page,
}, info) => {
  let held: Route | undefined
  await page.route(SETTINGS_CHUNK, (route) => {
    held = route
  })
  await installBackend(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(serializePlatformRoute({ module_id: 'settings', scope: projectScope }))

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
