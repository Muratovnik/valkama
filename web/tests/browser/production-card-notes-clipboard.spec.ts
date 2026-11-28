import { expect } from '@playwright/test'

import { expectNote, openCard } from './cardNotesPage.ts'
import { expectNoSilentClipping } from './overflow.ts'
import { workItemRef } from './planningFixtures.ts'
import { test } from './test.ts'

/**
 * The notes of a card's identity line after a copy, with the copy read back from the system
 * clipboard, which this spec is granted (`clipboardSpecs.ts`). The rest of the notes are in
 * `production-card-notes.spec.ts`.
 */

test.beforeEach(async ({ context }) => {
  await context.grantPermissions(['clipboard-write', 'clipboard-read'])
})

// 430px is a phone whose line holds a note's words once the date, the kind and the anchor have
// stepped aside; at 390px the bar's «…» leaves the line too short for them, and the glyph says it.
const notesAt = [
  [1500, 'whole'],
  [1280, 'whole'],
  [430, 'whole'],
  [390, 'stepped aside'],
] as const
for (const [width, words] of notesAt) {
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
    await expectNote(page, drawer, 'Ссылка скопирована', { words })
    await expectNoSilentClipping(page, `link note at ${width}px`)

    // The reference copies itself.
    await drawer.locator('.head-reference').click()
    await expect.poll(clipboard).toBe(workItemRef.reference)
    await expectNote(page, drawer, `${workItemRef.reference} скопирован`, { words })
  })
}
