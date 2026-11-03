import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { planningWorkItemEntity } from '@/shared/api/platformPlanningRefs.ts'
import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { installBackend } from './backend.ts'
import { expectNoSilentClipping } from './overflow.ts'
import { projectScope, workItemRef } from './planningFixtures.ts'
import { test } from './test.ts'

/**
 * What the card's identity line says after a press there — the reference copied, the
 * link copied. The line has one height, and a phone leaves it a few dozen pixels: these
 * notes used to be cut to «Ссылка скопиров…».
 */

/** The card in Russian, the longer of the two languages, read from the clipboard's side. */
async function openCard(page: Page, width: number) {
  await page.addInitScript(() => localStorage.setItem('valkama-locale', 'ru'))
  await page.setViewportSize({ width, height: 900 })
  await installBackend(page)
  await page.context().grantPermissions(['clipboard-write', 'clipboard-read'])
  await page.goto(
    serializePlatformRoute({
      module_id: 'planning',
      scope: projectScope,
      entity: planningWorkItemEntity(workItemRef),
    }),
  )
  const drawer = page.locator('.drawer')
  await expect(drawer.locator('.card-identity')).toBeVisible()
  return drawer
}

/**
 * A note in the head says what a press did, and is never cut: its glyph stands at any
 * width, its words only where the line holds them whole, and the status region always
 * carries the whole sentence.
 */
async function expectNoteWhole(
  page: Page,
  drawer: Locator,
  sentence: string,
  glyph: 'check' | 'circle-alert' = 'check',
) {
  await expect(drawer.locator('.card-identity [role="status"]')).toHaveText(sentence)
  const shown = drawer.locator('.card-identity .identity-note')
  await expect(shown).toBeVisible()
  await expect(shown).toHaveAttribute('title', sentence)
  // A failure keeps a glyph of its own, so it never reads as done.
  const mark = shown.locator('.identity-note-glyph')
  await expect(mark).toBeVisible()
  await expect(mark).toHaveClass(new RegExp(`(^| )lucide-${glyph}( |$)`, 'u'))
  const words = shown.locator('.identity-note-words')
  // Either the whole sentence or none of it: the browser's own measure of the box.
  const cut = await words.evaluateAll((nodes) =>
    nodes.filter((node) => node.scrollWidth > node.clientWidth).map((node) => node.textContent),
  )
  expect(cut).toEqual([])
  const said = await words.allTextContents()
  expect(said.every((text) => text === sentence)).toBe(true)
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBe(0)
}

for (const width of [1280, 390]) {
  test(`every note in the head is said whole, never cut, at ${width}px`, async ({ page }) => {
    const drawer = await openCard(page, width)
    const clipboard = () => page.evaluate(() => navigator.clipboard.readText())

    // The link, from the keyboard: the reference, then its link.
    const link = drawer.getByRole('button', {
      name: `Копировать ссылку на ${workItemRef.reference}`,
    })
    await drawer.locator('.head-reference').focus()
    await page.keyboard.press('Tab')
    await expect(link).toBeFocused()
    await page.keyboard.press('Enter')
    const address = `${new URL(page.url()).origin}/open/${workItemRef.reference}`
    await expect.poll(clipboard).toBe(address)
    await expectNoteWhole(page, drawer, 'Ссылка скопирована')
    await expectNoSilentClipping(page, `link note at ${width}px`)

    // The reference copies itself.
    await drawer.locator('.head-reference').click()
    await expect.poll(clipboard).toBe(workItemRef.reference)
    await expectNoteWhole(page, drawer, `${workItemRef.reference} скопирован`)
  })
}

test('on a desktop drawer the date gives way, and the note stands in words', async ({ page }) => {
  const drawer = await openCard(page, 1280)
  await drawer.locator('.identity-link').click()
  await expectNoteWhole(page, drawer, 'Ссылка скопирована')
  await expect(drawer.locator('.identity-note-words')).toHaveText('Ссылка скопирована')
  // The date is shortened as it always was, with the ellipsis that says so.
  await expect(drawer.locator('.identity-updated')).toHaveCSS('text-overflow', 'ellipsis')
})

test('a link the clipboard refuses is said to have failed, not to have been copied', async ({
  page,
}) => {
  const drawer = await openCard(page, 390)
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: () => Promise.reject(new DOMException('denied', 'NotAllowedError')) },
    })
  })
  await drawer
    .getByRole('button', { name: `Копировать ссылку на ${workItemRef.reference}` })
    .click()
  await expect(drawer.locator('.identity-note-glyph')).toBeVisible()
  await expectNoteWhole(page, drawer, 'Не удалось скопировать ссылку', 'circle-alert')
})
