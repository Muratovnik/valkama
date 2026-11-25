import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { planningWorkItemEntity } from '@/shared/api/platformPlanningRefs.ts'
import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { installBackend } from './backend.ts'
import { expectNoSilentClipping } from './overflow.ts'
import { spaceScope, workItemRef } from './planningFixtures.ts'
import { test } from './test.ts'

/**
 * What the card's identity line says after a press there — the reference copied, the
 * link copied. The line has one height, and a phone leaves it a few dozen pixels: these
 * notes used to be cut to «Ссылка скопиров…», while on a desktop the date beside them was
 * cut to «04 нояб.,…». Now nothing is cut: the date, then the kind and the anchor, and
 * last the note's words step aside whole. Where the bar's «…» leaves a phone's line too
 * short for the words, the glyph stays and says it, the whole sentence in its tooltip.
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
      scope: spaceScope,
      entity: planningWorkItemEntity(workItemRef),
    }),
  )
  const drawer = page.locator('.drawer')
  await expect(drawer.locator('.card-identity')).toBeVisible()
  return drawer
}

/**
 * A note in the head says what a press did, whole: its glyph, and its whole sentence in
 * the status region and the glyph's tooltip. Its words stand on screen beside the glyph
 * whole, or, on a line too short for them once all else has stepped aside, not at all:
 * never cut. Nothing else on the line is cut to make room for it.
 */
async function expectNote(
  page: Page,
  drawer: Locator,
  sentence: string,
  {
    words,
    glyph = 'check',
  }: { words: 'whole' | 'stepped aside'; glyph?: 'check' | 'circle-alert' },
) {
  await expect(drawer.locator('.card-identity [role="status"]')).toHaveText(sentence)
  const shown = drawer.locator('.card-identity .identity-note')
  await expect(shown).toBeVisible()
  await expect(shown).toHaveAttribute('data-tooltip', sentence)
  // A failure keeps a glyph of its own, so it never reads as done.
  const mark = shown.locator('.identity-note-glyph')
  await expect(mark).toBeVisible()
  await expect(mark).toHaveClass(new RegExp(`(^| )lucide-${glyph}( |$)`, 'u'))
  if (words === 'whole') {
    await expect(shown.locator('.identity-note-words')).toHaveText(sentence)
  } else {
    // The words are the last to step aside: the date, the kind and the anchor went first.
    await expect(shown.locator('.identity-note-words')).toHaveCount(0)
    await expect(
      drawer
        .locator('.card-identity')
        .locator('.identity-updated, .identity-kind, .identity-source'),
    ).toHaveCount(0)
  }
  // Nothing on the line is cut to an ellipsis or past its edge: the browser's own measure.
  const cut = await drawer
    .locator('.card-identity, .card-identity :not(.visually-hidden)')
    .evaluateAll((nodes) =>
      nodes
        .filter((node) => node.scrollWidth > node.clientWidth + 1 && node.clientWidth > 0)
        .map((node) => node.className),
    )
  expect(cut).toEqual([])
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBe(0)
}

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
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: () => Promise.reject(new DOMException('denied', 'NotAllowedError')) },
    })
  })
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
