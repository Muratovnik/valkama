/**
 * A saved view this build does not read, and a link a build before this one wrote, in the built
 * application, in English and in Russian, at a desk's width and a phone's. A view holding a value
 * no reader here reads is removed and named once by the view's menu, however the page came to
 * be opened; an old link is read as the board reads it, so a view saved from it is kept. The
 * menu's note is measured, not looked at: inside the menu, the menu inside the window, nothing cut.
 */
import { writeFileSync } from 'node:fs'

import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { routeState } from './boardPage.ts'
import { expectNoSilentClipping } from './overflow.ts'
import { spaceRef } from './planningFixtures.ts'
import { choose, listed, openMenu, openSpace, seed, WORDS } from './savedViewsPage.ts'
import { test } from './test.ts'

/** The open menu's box, its note's, its first entry's, and the window's width. */
function measureNote(page: Page) {
  return page.getByRole('menu').evaluate((list) => {
    // A part the menu lacks measures as the whole menu, which no assertion below lets pass.
    const box = (selector: string | null) => {
      const part = selector === null ? list : (list.querySelector(selector) ?? list)
      const { left, right, top, bottom } = part.getBoundingClientRect()
      return { left, right, top, bottom }
    }
    return {
      window: document.documentElement.clientWidth,
      menu: box(null),
      note: box('.menu-note'),
      first: box('[role^="menuitem"]'),
    }
  })
}

/**
 * A view saved by a build that knew a value this one does not — here a grouping by something
 * gone — would open as another view under the old name. It is removed as the space opens, and
 * the menu names it once, as its description and its first line, inside the window — though
 * the page was loaded again before the menu was opened.
 */
for (const locale of ['en', 'ru'] as const)
  for (const width of [1280, 390])
    test(`a saved view this build does not read is removed and named once (${locale}, ${width}px)`, async ({
      page,
    }, info) => {
      const words = WORDS[locale]
      const note = words.dropped('Former lanes')
      await seed(page, locale, width)
      await openSpace(page, spaceRef, { group: 'goal' })
      for (const name of ['Former lanes', 'Lanes']) {
        await choose(page, locale, 'menuitem', words.save)
        await page.getByRole('dialog').getByRole('textbox', { name: words.name }).fill(name)
        await page.getByRole('dialog').getByRole('button', { name: words.confirm }).click()
        await expect(page.getByRole('dialog')).toHaveCount(0)
      }
      // As a build that knew the grouping would have kept it: the first view saved.
      await page.evaluate(() => {
        const settings = JSON.parse(localStorage.getItem('valkama-settings') ?? '{}')
        const [views] = Object.values(settings.views) as { name: string; state: object }[][]
        views[0].state = { ...views[0].state, group: 'former' }
        localStorage.setItem('valkama-settings', JSON.stringify(settings))
      })
      await page.reload()
      await expect(page.locator('[data-reference]').first()).toBeVisible()
      const kept = await page.evaluate(() =>
        Object.values(JSON.parse(localStorage.getItem('valkama-settings') ?? '{}').views)
          .flat()
          .map((view) => (view as { name: string }).name),
      )
      expect(kept).toEqual(['Lanes'])
      // Gone from the settings already, and loaded again before anyone opened the menu.
      await page.reload()
      await expect(page.locator('[data-reference]').first()).toBeVisible()

      await openMenu(page, locale)
      const menu = page.getByRole('menu')
      await expect(menu).toHaveAccessibleDescription(note)
      await expect(menu.locator('.menu-note')).toHaveText(note)
      const at = await measureNote(page)
      writeFileSync(info.outputPath('note-boxes.json'), JSON.stringify(at))
      expect(at.menu.left).toBeGreaterThanOrEqual(0)
      expect(at.menu.right).toBeLessThanOrEqual(at.window)
      expect(at.note.left).toBeGreaterThanOrEqual(at.menu.left)
      expect(at.note.right).toBeLessThanOrEqual(at.menu.right)
      expect(at.note.bottom).toBeLessThanOrEqual(at.first.top)
      await expectNoSilentClipping(page, `view menu note ${locale} ${width}px`, '.menu-popup')
      await page.keyboard.press('Escape')
      await expect(menu).toHaveCount(0)

      // Said once: neither the menu opened again nor a reload says it.
      expect(await listed(page, locale)).toEqual(['Lanes'])
      await openMenu(page, locale)
      await expect(page.getByRole('menu').locator('.menu-note')).toHaveCount(0)
      await page.keyboard.press('Escape')
      await page.reload()
      await expect(page.locator('[data-reference]').first()).toBeVisible()
      await openMenu(page, locale)
      await expect(page.getByRole('menu').locator('.menu-note')).toHaveCount(0)
    })

/**
 * A link a build before this one wrote, grouped by something gone and filtered by a category
 * gone: the address is written again as the board reads it, so a view saved from it holds what
 * the screen shows, and is kept, rather than removed the moment it is saved.
 */
for (const locale of ['en', 'ru'] as const)
  test(`a view saved from an old link keeps what the screen shows (${locale})`, async ({
    page,
  }) => {
    const words = WORDS[locale]
    await seed(page, locale, 1280)
    await openSpace(page, spaceRef, { group: 'former', cat: 'queued,triage' })
    await expect.poll(() => routeState(page)).toEqual({ view: 'kanban', cat: 'triage' })
    await choose(page, locale, 'menuitem', words.save)
    await page.getByRole('dialog').getByRole('textbox', { name: words.name }).fill('From old link')
    await page.getByRole('dialog').getByRole('button', { name: words.confirm }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    const states = await page.evaluate(() =>
      Object.values(JSON.parse(localStorage.getItem('valkama-settings') ?? '{}').views)
        .flat()
        .map((view) => (view as { state: object }).state),
    )
    expect(states).toEqual([{ view: 'kanban', cat: 'triage' }])
    await openMenu(page, locale)
    await expect(page.getByRole('menu').locator('.menu-note')).toHaveCount(0)
    await page.keyboard.press('Escape')
    expect(await listed(page, locale)).toEqual(['From old link'])
  })
