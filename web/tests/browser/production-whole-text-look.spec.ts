/**
 * The whole words of a cut text take the look of its line, not of the run its first letter
 * stands in, in the built app. Read from the element that held the first letter, the whole
 * words over a board tile's title that starts with code were all set in code's type on code's
 * ground, and over an outcome's preview that starts with a link all in the link's ink. Now they
 * take the type, the ink and the ground of the line the cut element draws, and the code drawn in
 * them stays code.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import {
  DONE,
  DONE_WORDS,
  markClamp,
  openBoard,
  outcomePreview,
  restAt,
  whole,
} from './cutFieldPage.ts'
import { workItemRef } from './planningFixtures.ts'
import { test } from './test.ts'

/** A piece of code a title or a preview starts with. */
const CODE = 'store.read'

/**
 * What follows the code in a title: after it, within the 200 characters a title may have, and
 * longer than three lines of a board column's tile.
 */
const AFTER_CODE =
  'reads an attached planning store that an older build wrote without migrating it, names every scope the read had to skip instead of dropping it, and says which a newer build can open'

/**
 * The look of the whole words over the marked cut text, of the cut text's line, and of the run
 * its first letter stands in: the type and the ink each sets, and the ground under it. The
 * ground under an element is the first one from it up that is not see-through, every one between
 * being none: the whole words lay any see-through one over it, which this reading does not, so
 * one in between reads as itself and fails the comparison. The code in the cut text and in the
 * whole words, where there is any, by the type it is set in.
 */
const lookAgainstLine = (page: Page) =>
  page.evaluate(() => {
    const line = document.querySelector<HTMLElement>('[data-probe-cut]')
    const laid = document.querySelector<HTMLElement>('.whole-text')
    if (!line || !laid) throw new Error('no whole words over the marked cut text')
    const NONE = 'rgba(0, 0, 0, 0)'
    const groundUnder = (element: Element) => {
      let box: Element | null = element
      while (box && getComputedStyle(box).backgroundColor === NONE) box = box.parentElement
      const color = box ? getComputedStyle(box).backgroundColor : NONE
      return color.startsWith('rgb(') ? color : `see-through ${color}`
    }
    const look = (element: Element, ground: string) => ({
      family: getComputedStyle(element).fontFamily,
      ink: getComputedStyle(element).color,
      ground,
    })
    const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT)
    let node = walker.nextNode()
    while (node && !node.textContent?.trim()) node = walker.nextNode()
    const run = node?.parentElement ?? line
    const typeOf = (code: Element | null) => (code ? getComputedStyle(code).fontFamily : null)
    return {
      line: look(line, groundUnder(line)),
      first: look(run, groundUnder(run)),
      laid: look(laid, getComputedStyle(laid).backgroundColor),
      code: { cut: typeOf(line.querySelector('code')), laid: typeOf(laid.querySelector('code')) },
    }
  })

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('valkama-locale', 'en'))
  await page.clock.install()
})

// A title drawn in runs (`textRuns.ts`) that starts with a piece of code: its first letter
// stands in the code's element.
for (const width of [1440, 390])
  test(`at ${width}px the whole words of a tile's title that starts with code are in the title's type, ink and ground, its code in code's`, async ({
    page,
  }) => {
    await openBoard(page, width, `\`${CODE}\` ${AFTER_CODE}`)
    const tile = page.locator(`[data-reference="${workItemRef.reference}"] .work-item-tile`)
    const point = await markClamp(tile.locator('.tile-title'))
    expect(point, 'a title its clamp cuts, in sight').not.toBeNull()
    await restAt(page, point ?? { x: 0, y: 0 })
    await expect(whole(page)).toHaveText(`${CODE} ${AFTER_CODE}`)
    const { line, first, laid, code } = await lookAgainstLine(page)
    expect(first, "the cut title's first letter stands in code's look").not.toEqual(line)
    expect(laid, 'the whole words against the title').toEqual(line)
    expect(code.cut, "the cut title's code").not.toBe(line.family)
    expect(code.laid, 'the code in the whole words').toBe(code.cut)
  })

// A preview whose words start inside a piece of code, or inside a link in the accent's ink
// (`RichInlines`); its whole words are its plain text.
for (const [start, done, words] of [
  ['code', `\`${CODE}\` ${DONE}`, `${CODE} ${DONE_WORDS}`],
  ['a link', `[Shipped](https://example.com/reader)${DONE.slice('Shipped'.length)}`, DONE_WORDS],
])
  test(`the whole words of an outcome's preview that starts with ${start} are in the preview's type, ink and ground`, async ({
    page,
  }) => {
    const preview = await outcomePreview(page, done)
    const point = await markClamp(preview)
    expect(point, 'a preview its clamp cuts, in sight').not.toBeNull()
    await restAt(page, point ?? { x: 0, y: 0 })
    await expect(whole(page)).toHaveText(words)
    const { line, first, laid } = await lookAgainstLine(page)
    expect(first, "the cut preview's first letter stands in a look of its own").not.toEqual(line)
    expect(laid, 'the whole words against the preview').toEqual(line)
  })
