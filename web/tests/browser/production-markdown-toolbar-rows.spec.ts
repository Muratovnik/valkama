/**
 * An editor's toolbar on a phone keeps its 44px icons and takes a second line for the switch
 * between the text and its preview; the switch then stands at the end of that line, as a
 * form's buttons do, and not at its start under the bold and the italic. On a desktop the
 * toolbar is one line. Read in both languages, since the Russian switch is the wider one, in
 * a comment in the card's drawer and in the new-work dialog.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { installBackend } from './backend.ts'
import { installDiscussionBackend } from './discussionBackend.ts'
import { projectScope } from './planningFixtures.ts'
import { test } from './test.ts'

const BOARD = serializePlatformRoute({ module_id: 'planning', scope: projectScope })

/** Where the switch is drawn against the toolbar's content box and its row of icons. */
async function placement(bar: Locator) {
  return bar.evaluate((node) => {
    const own = node.getBoundingClientRect()
    const contentEnd = own.right - Number.parseFloat(getComputedStyle(node).paddingRight)
    const tools = node.querySelector('.markdown-tools')?.getBoundingClientRect()
    const view = node.querySelector('.segmented')?.getBoundingClientRect()
    if (!tools || !view) throw new Error('a toolbar without its icons or its switch')
    return {
      ownRow: view.top >= tools.bottom - 0.5,
      sameRow: view.top < tools.bottom && view.bottom > tools.top,
      endGap: Math.round((contentEnd - view.right) * 10) / 10,
      startGap: Math.round((view.left - tools.left) * 10) / 10,
    }
  })
}

async function settle(page: Page) {
  await page.evaluate(async () => {
    await Promise.all(document.getAnimations().map(async (run) => run.finished))
  })
}

async function commentToolbar(page: Page) {
  await installDiscussionBackend(page)
  await page.goto(BOARD)
  await page.locator('.work-item-column[data-state="dev"] .work-item-tile').first().click()
  const bar = page.locator('.drawer .markdown-toolbar').first()
  await expect(bar).toBeVisible()
  await settle(page)
  return bar
}

async function newWorkToolbar(page: Page) {
  await installBackend(page)
  await page.goto(BOARD)
  await page.locator('.workspace-action').click()
  const bar = page.getByRole('dialog').locator('.markdown-toolbar').first()
  await expect(bar).toBeVisible()
  await settle(page)
  return bar
}

for (const locale of ['en', 'ru'] as const)
  for (const [where, open] of [
    ['a comment in the drawer', commentToolbar],
    ['the new-work dialog', newWorkToolbar],
  ] as const) {
    test(`the switch ends its line on a phone and the bar is one line wide open, in ${where}, ${locale}`, async ({
      page,
    }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await page.addInitScript((chosen) => localStorage.setItem('valkama-locale', chosen), locale)

      await page.setViewportSize({ width: 390, height: 844 })
      const phone = await placement(await open(page))
      // The 44px icons leave the switch no room beside them at this width.
      expect(phone.ownRow, `the switch on a line of its own: ${JSON.stringify(phone)}`).toBe(true)
      expect(
        Math.abs(phone.endGap),
        `the switch at the line's end: ${JSON.stringify(phone)}`,
      ).toBeLessThanOrEqual(1)

      await page.setViewportSize({ width: 1280, height: 900 })
      const desk = await placement(await open(page))
      expect(desk.sameRow, `one line: ${JSON.stringify(desk)}`).toBe(true)
      expect(
        Math.abs(desk.endGap),
        `the switch at the line's end: ${JSON.stringify(desk)}`,
      ).toBeLessThanOrEqual(1)
    })
  }
