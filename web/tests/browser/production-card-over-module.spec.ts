/**
 * A task's card opens over whatever module it was opened in, in the real app, whichever way it was
 * opened: a task link in a question waiting in Settings, and the task finder (Ctrl+K) on the
 * Analytics page. The oracle is the requirement: the module stays the one on show, its address
 * keeps its view and names the card as the board's address does, so Back closes it, and closing it
 * gives the module back as it was left — its section and where it was scrolled to. A modified
 * press on the link is still the link's. Each run prints what it measured.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { planningWorkItemRef } from '@/shared/api/platformPlanningRefs.ts'
import { parsePlatformRoute, serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { pageAt, record, serve, serveTask } from './analyticsPage.ts'
import { installBackend } from './backend.ts'
import { globalScope, workItem, workItemRef } from './planningFixtures.ts'
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
async function openSettings(page: Page) {
  await installBackend(page)
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
