import type { Locator, Page } from '@playwright/test'

import { aCardAsking, HUGE_PATH, linkTo } from './documentBackend.ts'

/**
 * What the specs of when a document may take focus do: hold a read, change what the server
 * answers, and bring the window back.
 *
 * The window's return here is a changed answer from the server and a `focus` event on the
 * window. A real change of tab gives a headless browser no such event, so that is as far as
 * this can prove it: the event is what the page listens to, and a person's return is not run.
 */

export const READ = '**/api/documents/read*'

export const SHORTENED = {
  json: {
    project: 'demo',
    path: HUGE_PATH,
    markdown: '# Cut down\n\nShorter now.\n\n## The target <!-- kb:a7f3 -->\n\nThe block.\n',
    size: 60,
    modified_at: '2026-11-03T15:20:00Z',
    revision: 'bbbbbbbbbbbbbbbb',
  },
}

const doNothing = () => {}

/** Every read from here on waits to be let go, then answers this or as it would have. */
export async function heldReads(page: Page, answer?: object) {
  let letGo = doNothing
  const released = new Promise<void>((resolve) => {
    letGo = resolve
  })
  await page.route(READ, async (route) => {
    await released
    await (answer ? route.fulfill(answer) : route.fallback()).catch(() => {})
  })
  return letGo
}

export const answering = (page: Page, answer: object) =>
  page.route(READ, (route) => route.fulfill(answer))

/** What the page listens to when the window comes back; see the head of this file. */
export const windowComesBack = (page: Page) =>
  page.evaluate(() => {
    globalThis.dispatchEvent(new Event('focus'))
  })

/** The panel stands there while the read is under way too, and says so. */
export const settledRefusal = (scope: Locator | Page) =>
  scope.locator('.document-refusal .platform-state-panel:not([aria-busy])')

export const paneOf = (page: Page) => {
  const pane = page.locator('.overlay-pane')
  return {
    pane,
    title: pane.locator('.overlay-header-name'),
    target: pane.locator('.document-block.is-target'),
    text: pane.locator('.document-text'),
    refusal: settledRefusal(pane),
  }
}

export async function openFromCard(page: Page, path: string, width = 1500) {
  await page.setViewportSize({ width, height: 900 })
  const opened = await aCardAsking(page, `Read \`${path}\` first.`)
  return { ...opened, link: linkTo(opened.drawer, path) }
}

export async function pressLink(link: Locator, press: 'key' | 'pointer') {
  if (press === 'pointer') await link.click()
  else {
    await link.focus()
    await link.press('Enter')
  }
}
