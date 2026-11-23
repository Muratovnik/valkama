/**
 * A task's card opens over whatever module it was opened in, in the real app, whichever way it was
 * opened: a task link in a question waiting in Settings, and the task finder (Ctrl+K) on the
 * Analytics page. The oracle is the requirement: the module stays the one on show, its address
 * keeps its view and names the card as the board's address does, so Back closes it, and closing it
 * gives the module back as it was left — its section and where it was scrolled to. A modified
 * press on the link is still the link's. A card whose space cannot be read says so in the board's
 * words and still edits what needs no space. Each run prints what it measured.
 */
import { expect } from '@playwright/test'
import type { Locator, Page, Route } from '@playwright/test'

import { planningWorkItemRef } from '@/shared/api/platformPlanningRefs.ts'
import { parsePlatformRoute, serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { pageAt, record, serve, serveTask } from './analyticsPage.ts'
import { installBackend } from './backend.ts'
import type { BackendOptions } from './backend.ts'
import { CARD_CHUNK } from './cardCode.ts'
import { globalScope, spaceScope, workItem, workItemRef } from './planningFixtures.ts'
import { asked, installQuestions } from './questionBackend.ts'
import { test } from './test.ts'

const path = (page: Page) => page.url().slice(new URL(page.url()).origin.length)

/** Settings at its General section, named in the address so that keeping it says something. */
const SETTINGS = serializePlatformRoute({
  module_id: 'settings',
  scope: globalScope,
  state: { section: 'general' },
})

/** What Settings shows of its view: the section its tabs mark, and how far its frame scrolled. */
async function settingsShown(page: Page) {
  const section = page.getByRole('tablist', { name: 'Settings section' }).getByRole('tab', {
    selected: true,
  })
  return {
    section: await section.evaluate((node) => node.textContent?.trim()),
    scrollTop: await page.locator('.module-frame').evaluate((frame) => frame.scrollTop),
  }
}

/** Settings at a height its frame scrolls in, scrolled down, with one question waiting. */
async function openSettings(page: Page, backend: BackendOptions = {}) {
  await installBackend(page, backend)
  await installQuestions(page, [asked()])
  await page.setViewportSize({ width: 1280, height: 480 })
  await page.goto(SETTINGS)
  await expect(page.locator('.settings-page')).toBeVisible()
  const frame = page.locator('.module-frame')
  await frame.evaluate((element) => element.scrollTo({ top: element.scrollHeight }))
  await expect.poll(() => frame.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
  return settingsShown(page)
}

/** The questions waiting, opened from the rail, and the task link in the one there. */
async function questionLink(page: Page) {
  await page.getByRole('button', { name: /^Needs my answer/u }).click()
  const dialog = page.getByRole('dialog', { name: 'Needs my answer', exact: true })
  const link = dialog.locator('.request-context').getByRole('link', {
    name: workItemRef.reference,
  })
  await expect(link).toBeVisible()
  return { dialog, link }
}

/** The card on show, over the module whose path the address still has. */
async function expectCardOver(page: Page, module: string) {
  const drawer = page.locator('.drawer')
  await expect(drawer).toContainText(workItem.title)
  await expect(drawer.locator('.card-priority')).toBeVisible()
  expect(new URL(page.url()).pathname.startsWith(`/modules/${module}/`)).toBe(true)
  const opened = parsePlatformRoute(new URL(page.url()))
  expect(opened.module_id).toBe(module)
  expect(planningWorkItemRef(opened.entity)).toEqual(workItemRef)
  return { drawer, opened }
}

test('a task link pressed in a question over Settings opens its card over Settings, which Back closes', async ({
  page,
}, info) => {
  const before = await openSettings(page)
  const { dialog, link } = await questionLink(page)
  await link.click()
  // The questions give way to the card, which stands over Settings with its view kept.
  await expect(dialog).toBeHidden()
  const { drawer, opened } = await expectCardOver(page, 'settings')
  expect(opened.state).toEqual({ section: 'general' })
  // With its space read, the state is the menu of where the item can go.
  await expect(drawer.locator('.card-state .choice-trigger')).toHaveCount(1)
  await expect(page.locator('.settings-page')).toBeVisible()
  const under = await settingsShown(page)

  await page.goBack()
  await expect(drawer).toBeHidden()
  await expect.poll(() => path(page)).toBe(SETTINGS)
  const after = await settingsShown(page)
  await record(info, 'card over settings', { before, under, after })
  expect(under).toEqual(before)
  expect(after).toEqual(before)
  expect(after.section).toBe('General')
})

/** The words an element shows, without the space around them. */
async function words(element: Locator) {
  const text = await element.textContent()
  return text?.trim() ?? ''
}

/** Every read of the space fails, as a server that cannot read it answers; the card's own read stands. */
async function failSpaceRead(page: Page) {
  await page.route('**/api/planning?*', (route) =>
    route.fulfill({ status: 500, contentType: 'application/json', body: '{}' }),
  )
}

test('a card over Settings whose space cannot be read says so as the board does, and its priority still edits', async ({
  page,
}, info) => {
  // The board's own words for the same failed read, which the card over a page must say too.
  await installBackend(page)
  await failSpaceRead(page)
  await page.goto(
    serializePlatformRoute({
      module_id: 'planning',
      scope: spaceScope,
    }),
  )
  const boardPanel = page.locator('.platform-state-panel .platform-state-reason')
  await expect(boardPanel).toBeVisible()
  const boardSays = await words(boardPanel)
  expect(boardSays).not.toBe('')

  // The store's record of the task, which the card reads and writes: a field written is what
  // the next read answers.
  const held = { priority: workItem.priority as string, revision: 3 }
  await openSettings(page, { card: (read) => ({ ...read, ...held }) })
  await failSpaceRead(page)
  const writes: Record<string, unknown>[] = []
  await page.route('**/api/planning/work-item/update', async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>
    writes.push(body)
    if (typeof body.priority === 'string') held.priority = body.priority
    held.revision += 1
    await route.fulfill({ json: { ...workItem, ...held } })
  })
  const { link } = await questionLink(page)
  await link.click()
  const { drawer } = await expectCardOver(page, 'settings')

  // The shell's notice says it, in the words the board says it in.
  const notice = page.locator('.notice .notice-message')
  await expect(notice).toBeVisible()
  const noticeSays = await words(notice)
  await record(info, 'space unread over settings', { boardSays, noticeSays })
  expect(noticeSays).toBe(boardSays)
  // The state is shown, not offered as a menu with nowhere to go.
  await expect(drawer.locator('.card-state')).toBeVisible()
  await expect(drawer.locator('.card-state .choice-trigger')).toHaveCount(0)

  // A field the space is not needed for still edits, and the write reaches the store.
  await drawer.locator('.card-priority .choice-trigger').click()
  await page.getByRole('option', { name: /^Urgent/u }).click()
  await expect.poll(() => writes.length).toBe(1)
  expect(writes[0]).toMatchObject({ id: workItemRef.reference, priority: 'urgent' })
  await expect(drawer.locator('.card-priority')).toContainText('Urgent')
})

// The card's own code downloads on demand: Settings never asks for it before a card.
test('a card opened over Settings before its code arrives waits in its frame there, then shows', async ({
  page,
}) => {
  let held: Route | undefined
  await page.route(CARD_CHUNK, (route) => {
    held = route
  })
  await openSettings(page)
  const { link } = await questionLink(page)
  await link.click()

  // The card's frame stands over Settings with its wait, and the address already names the card.
  const drawer = page.locator('.drawer')
  await expect(drawer.locator('[aria-busy="true"]')).toContainText('Loading')
  await expect(page.getByRole('heading', { name: workItem.title })).toHaveCount(0)
  expect(planningWorkItemRef(parsePlatformRoute(new URL(page.url())).entity)).toEqual(workItemRef)
  await expect(page.locator('.settings-page')).toBeVisible()

  await expect.poll(() => held !== undefined).toBe(true)
  await held?.continue()
  await expectCardOver(page, 'settings')
})

test('a card over Settings still waiting for its code closes from its bar and with Escape, back to Settings', async ({
  page,
}) => {
  await page.route(CARD_CHUNK, () => {})
  const before = await openSettings(page)
  const drawer = page.locator('.drawer')
  // The frame's own close, and the drawer's: Escape, which asks the panel and not the frame.
  for (const close of [
    () => drawer.getByRole('button', { name: 'Close', exact: true }).click(),
    () => page.keyboard.press('Escape'),
  ]) {
    const { link } = await questionLink(page)
    await link.click()
    await expect(drawer.locator('[aria-busy="true"]')).toContainText('Loading')
    await close()
    await expect(drawer).toHaveCount(0)
    await expect.poll(() => path(page)).toBe(SETTINGS)
    expect(await settingsShown(page)).toEqual(before)
  }
})

test('a modified press on a task link in a question over Settings stays a link', async ({
  page,
}) => {
  await openSettings(page)
  const { link } = await questionLink(page)
  // A press with Ctrl is the browser's to take elsewhere: the app leaves it be and opens nothing.
  // The press is stopped before the browser follows it, so no address is opened from here.
  await page.evaluate(() => {
    window.addEventListener('click', (event) => {
      if (!event.ctrlKey) return
      document.body.dataset.leftToBrowser = String(!event.defaultPrevented)
      event.preventDefault()
    })
  })
  await link.click({ modifiers: ['Control'] })
  await expect(page.locator('body')).toHaveAttribute('data-left-to-browser', 'true')
  expect(path(page)).toBe(SETTINGS)
  await expect(page.locator('.drawer')).toBeHidden()
})

test('a task opened from the finder on the Analytics page opens its card over the page', async ({
  page,
}, info) => {
  const VIEW = { period: 'weeks4' }
  const PAGE = pageAt(VIEW)
  await serve(page)
  await serveTask(page)
  await page.setViewportSize({ width: 1440, height: 800 })
  await page.goto(PAGE)
  await expect(page.locator('.analytics-panel .overview-panel')).toBeVisible()

  await page.keyboard.press('Control+k')
  const finder = page.getByRole('dialog', { name: 'Go to a task', exact: true })
  await finder.getByRole('combobox').fill(workItemRef.reference)
  await expect(finder.getByRole('option').first()).toContainText(workItem.title)
  await page.keyboard.press('Enter')
  await expect(finder).toBeHidden()
  const { drawer, opened } = await expectCardOver(page, 'analytics')
  expect(opened.state).toEqual(VIEW)
  await expect(page.locator('.analytics-panel .overview-panel')).toBeVisible()

  await page.goBack()
  await expect(drawer).toBeHidden()
  await expect.poll(() => path(page)).toBe(PAGE)
  await record(info, 'card over analytics from the finder', { opened: path(page) })
})
