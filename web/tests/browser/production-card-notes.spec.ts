import { expect } from '@playwright/test'

import { expectNote, openCard } from './cardNotesPage.ts'
import { expectNoSilentClipping } from './overflow.ts'
import { lastCopiedText, refuseClipboard } from './pageClipboard.ts'
import { workItemRef } from './planningFixtures.ts'
import { test } from './test.ts'

/**
 * What the card's identity line says after a press there — the reference copied, the
 * link copied. The line has one height, and a phone leaves it a few dozen pixels: these
 * notes used to be cut to «Ссылка скопиров…», while on a desktop the date beside them was
 * cut to «04 нояб.,…». Now nothing is cut: the date, then the kind and the anchor, and
 * last the note's words step aside whole. Where the bar's «…» leaves a phone's line too
 * short for the words, the glyph stays and says it, the whole sentence in its tooltip.
 *
 * The copies here land in the page's clipboard (`pageClipboard.ts`) and are read back from there;
 * the system clipboard's own check of a card's copy is in
 * `production-reference-preview-copy-clipboard.spec.ts`, whose card copies as the head does.
 */

test('on a desktop drawer the date is whole or not there, never a piece of one', async ({
  page,
}) => {
  const drawer = await openCard(page, 1500)
  const date = drawer.locator('.identity-updated')
  await expect(date).toBeVisible()
  const before = await date.textContent()
  await drawer.locator('.identity-link').click()
  await expectNote(page, drawer, 'Ссылка скопирована', { words: 'whole' })
  // Where it stays, it is the date it was, whole, and no ellipsis stands for the rest of it.
  const after = await drawer.locator('.card-identity').evaluate((line) => {
    const left = line.querySelector<HTMLElement>('.identity-updated')
    return left && { text: left.textContent, whole: left.scrollWidth <= left.clientWidth }
  })
  expect([null, { text: before, whole: true }]).toContainEqual(after)
})

test('a link the clipboard refuses is said to have failed, not to have been copied', async ({
  page,
}) => {
  const drawer = await openCard(page, 390)
  await refuseClipboard(page)
  await drawer
    .getByRole('button', { name: `Копировать ссылку на ${workItemRef.reference}` })
    .click()
  await expect(drawer.locator('.identity-note-glyph')).toBeVisible()
  // On a phone the glyph alone tells a refusal from a copy: its words have stepped aside.
  await expectNote(page, drawer, 'Ссылка не скопирована', {
    words: 'stepped aside',
    glyph: 'circle-alert',
  })
})

test('a note goes after a few seconds, and what stepped aside for it comes back', async ({
  page,
}) => {
  await page.clock.install()
  const drawer = await openCard(page, 390)
  const kind = drawer.locator('.identity-kind')
  const anchor = drawer.locator('.identity-source')
  await expect(kind).toBeVisible()
  await expect(anchor).toBeVisible()

  // From here the page's time moves only when the test moves it.
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1000)
  await drawer.locator('.identity-link').click()
  await expectNote(page, drawer, 'Ссылка скопирована', { words: 'stepped aside' })
  // A phone-wide line made room for the note: the kind and the anchor stepped aside.
  await expect(kind).toHaveCount(0)

  await page.clock.runFor(4900)
  await expect(drawer.locator('.identity-note')).toBeVisible()
  await page.clock.runFor(200)
  await expect(drawer.locator('.identity-note')).toHaveCount(0)
  await expect(drawer.locator('.card-identity [role="status"]')).toHaveText('')
  await expect(kind).toBeVisible()
  await expect(anchor).toBeVisible()
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
    const clipboard = () => lastCopiedText(page)

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
