/**
 * A card's row of sections on a phone, read off the page with the scrollbar a screen draws: the
 * row scrolled a little from either end, so its thumb runs under the fade of that end. The fade
 * says that sections lie past the end, so it is drawn over the sections there; the scrollbar
 * under them is how a reader gets to them, and it stands whole, in the same pixels as with no
 * fade at all. The fade was a mask over the whole scrolling row, and a mask takes the row's
 * scrollbar with what it scrolls: the thumb faded out at the cut end.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { fadedEnds, openCard, still } from './cardTabsRow.ts'
import { test } from './test.ts'

// Playwright hides scrollbars, and this spec is about the one the row draws.
test.use({ launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] } })

/** Where the row's parts stand: its box, its scrollbar's height, the fade's width and the thumb. */
const rowParts = (strip: Locator) =>
  strip.evaluate((node: HTMLElement) => {
    const { left, top, right, bottom } = node.getBoundingClientRect()
    return {
      box: { left, top, right, bottom },
      bar: node.offsetHeight - node.clientHeight,
      fade: Number.parseFloat(getComputedStyle(node).getPropertyValue('--size-strip-fade')),
      // Where the thumb runs, as the share the row shows and how far it is scrolled place it.
      thumb: {
        left: (node.scrollLeft / node.scrollWidth) * node.clientWidth + left,
        right: ((node.scrollLeft + node.clientWidth) / node.scrollWidth) * node.clientWidth + left,
      },
    }
  })

/** The pixels of a strip of the page, with the row's fade as it is drawn or with none. */
async function shot(
  page: Page,
  strip: Locator,
  clip: { height: number; width: number; x: number; y: number },
  fade: boolean,
) {
  await strip.evaluate((node: HTMLElement, drawn) => {
    node.style.maskImage = drawn ? '' : 'none'
  }, fade)
  await page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  )
  return page.screenshot({ clip, animations: 'disabled', caret: 'hide' })
}

type Box = Awaited<ReturnType<typeof rowParts>>['box']
type Thumb = Awaited<ReturnType<typeof rowParts>>['thumb']

/**
 * Each end of the row: where it is scrolled to, twelve pixels from that end, so a section is cut
 * at both ends and the thumb reaches this one; how far the thumb runs into the fade there; and
 * where the fade at that end starts.
 */
const ENDS = {
  start: {
    scrolled: () => 12,
    under: (box: Box, fade: number, thumb: Thumb) => box.left + fade - thumb.left,
    fadeFrom: (box: Box) => box.left,
  },
  end: {
    scrolled: (most: number) => most - 12,
    under: (box: Box, fade: number, thumb: Thumb) => thumb.right - (box.right - fade),
    fadeFrom: (box: Box, fade: number) => box.right - fade,
  },
}

for (const [end, at] of Object.entries(ENDS))
  test(`at 390px the row's scrollbar stands whole under the fade at its ${end}`, async ({
    page,
  }) => {
    const strip = await openCard(page, 390)
    const most = await strip.evaluate((node) => node.scrollWidth - node.clientWidth)
    await strip.evaluate((node, left) => node.scrollTo({ left }), at.scrolled(most))
    await still(strip)
    await expect.poll(() => fadedEnds(strip)).toMatchObject({ start: true, end: true })
    await page.mouse.move(0, 0)

    const { box, bar, fade, thumb } = await rowParts(strip)
    expect(bar, 'the row draws a scrollbar').toBeGreaterThanOrEqual(8)
    expect(fade, 'the fade has a width').toBeGreaterThan(0)
    // The thumb runs under the fade at this end: over a part of it, if not the whole.
    expect(at.under(box, fade, thumb), 'the thumb reaches into the fade').toBeGreaterThan(0)

    const scrollbar = { x: box.left, y: box.bottom - bar, width: box.right - box.left, height: bar }
    // The sections just over the scrollbar, across the fade at this end.
    const sections = {
      x: at.fadeFrom(box, fade),
      y: box.top,
      width: fade,
      height: box.bottom - bar - box.top,
    }
    const shown = {
      scrollbar: await shot(page, strip, scrollbar, true),
      sections: await shot(page, strip, sections, true),
    }
    const bare = {
      scrollbar: await shot(page, strip, scrollbar, false),
      sections: await shot(page, strip, sections, false),
    }
    expect(shown.sections.equals(bare.sections), 'the sections fade toward the end').toBe(false)
    expect(shown.scrollbar.equals(bare.scrollbar), 'the scrollbar as with no fade').toBe(true)
  })
