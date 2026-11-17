/**
 * The fade of a period chart that scrolls, read off the built page with the scrollbars a screen
 * draws: «Now», scrolled so that minutes lie past both edges and its scrollbar's thumb runs under
 * the fade at the scale. The fade says that periods lie past an edge, so it is drawn over the
 * periods there; the scrollbar under them is how a reader gets to them, and it stands whole, in
 * the same pixels as with no fade at all. The fade was a mask over the whole scrolling frame, and
 * a mask takes the frame's scrollbar with what it scrolls: the thumb faded out under the scale.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { task } from '../fixtures/analytics.ts'
import { openReport, pageAt, record } from './analyticsPage.ts'
import { at, serveLive } from './liveDouble.ts'
import { test } from './test.ts'

// Playwright hides scrollbars, and this spec is about the one the frame draws.
test.use({ launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] } })

const WORK = [
  { at: at(13, 40), group: { work_item: task(1, 'Fix the import') }, spend: { seconds: 240 } },
  { at: at(14, 20), group: { work_item: task(2, 'Ship the release') }, spend: { seconds: 180 } },
]

/** Where the frame's parts stand: its box, its scrollbar's height, the fade's width and the scale's. */
const frameParts = (frame: Locator) =>
  frame.evaluate((node: HTMLElement) => {
    const ruler = document.createElement('div')
    ruler.style.inlineSize = 'var(--period-fade)'
    node.append(ruler)
    const fade = ruler.getBoundingClientRect().width
    ruler.remove()
    const { left, top, right, bottom } = node.getBoundingClientRect()
    return {
      box: { left, top, right, bottom },
      bar: node.offsetHeight - node.clientHeight,
      fade,
      gutter: Number.parseFloat(getComputedStyle(node).getPropertyValue('--period-gutter')) || 0,
      // Where the thumb runs, as the share the frame shows and how far it is scrolled place it.
      thumb: {
        left:
          (node.scrollLeft / node.scrollWidth) * node.clientWidth +
          node.getBoundingClientRect().left,
        right:
          ((node.scrollLeft + node.clientWidth) / node.scrollWidth) * node.clientWidth +
          node.getBoundingClientRect().left,
      },
      start: node.dataset.hiddenStart !== undefined,
      end: node.dataset.hiddenEnd !== undefined,
      mask: getComputedStyle(node).maskImage,
    }
  })

/** The pixels of a strip of the page, with the frame's fade as it is drawn or with none. */
async function strip(
  page: Page,
  frame: Locator,
  clip: { height: number; width: number; x: number; y: number },
  fade: boolean,
) {
  await frame.evaluate((node: HTMLElement, drawn) => {
    node.style.maskImage = drawn ? '' : 'none'
  }, fade)
  await page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  )
  return page.screenshot({ clip, animations: 'disabled', caret: 'hide' })
}

for (const width of [1440, 1024, 390])
  test(`the scrollbar of a chart that scrolls stands whole under its fade at ${width}px`, async ({
    page,
  }, info) => {
    await serveLive(page, WORK)
    const analytics = await openReport(page, width, pageAt({ period: 'now' }))
    const days = analytics.locator('.spending-days')
    // A narrow page opens the section on its table: its chart, as a reader chooses it.
    await days.getByRole('radio', { name: 'Chart' }).check()
    await expect(days).toHaveAttribute('data-shown', 'chart')
    await expect(days.locator('.period-column')).toHaveCount(60)
    const frame = days.locator('.period-frame')
    await frame.evaluate((node) => node.scrollIntoView({ block: 'center' }))
    // Scrolled so that the middle of the thumb stands in the middle of the fade at the scale, or a
    // period's width in where a long thumb already reaches past it: minutes lie past both edges.
    await frame.evaluate((node) => {
      const ruler = document.createElement('div')
      ruler.style.inlineSize = 'var(--period-fade)'
      node.append(ruler)
      const fade = ruler.getBoundingClientRect().width
      ruler.remove()
      const gutter = Number.parseFloat(getComputedStyle(node).getPropertyValue('--period-gutter'))
      const thumb = (node.clientWidth * node.clientWidth) / node.scrollWidth
      const travel = (node.scrollWidth - node.clientWidth) / (node.clientWidth - thumb)
      node.scrollLeft = Math.max(24, (gutter + fade / 2 - thumb / 2) * travel)
    })
    await expect(frame).toHaveAttribute('data-hidden-start', '')
    await expect(frame).toHaveAttribute('data-hidden-end', '')
    await page.mouse.move(0, 0)
    const parts = await frameParts(frame)
    const { box, bar, fade, gutter } = parts
    const scrollbar = { x: box.left, y: box.bottom - bar, width: box.right - box.left, height: bar }
    // The plot just over the scrollbar, across the fade at the scale.
    const faded = { x: box.left + gutter, y: box.bottom - bar - 40, width: fade, height: 30 }
    const shown = {
      scrollbar: await strip(page, frame, scrollbar, true),
      plot: await strip(page, frame, faded, true),
    }
    const bare = {
      scrollbar: await strip(page, frame, scrollbar, false),
      plot: await strip(page, frame, faded, false),
    }
    await strip(page, frame, scrollbar, true)
    await info.attach(`scrollbar-${width}.png`, { body: shown.scrollbar, contentType: 'image/png' })
    await record(info, `period-fade-${width}`, parts)

    expect(bar, 'the frame draws a scrollbar').toBeGreaterThanOrEqual(8)
    // The thumb runs under the fade at the scale: over a part of it, if not the whole.
    expect(parts.thumb.left, 'the thumb starts before the fade ends').toBeLessThan(
      box.left + gutter + fade,
    )
    expect(parts.thumb.right, 'the thumb ends after the fade starts').toBeGreaterThan(
      box.left + gutter,
    )
    expect(parts.mask, 'the fade is drawn').not.toBe('none')
    // The fade is over the periods, and over none of the scrollbar.
    expect(shown.plot.equals(bare.plot), 'the periods fade toward the scale').toBe(false)
    expect(shown.scrollbar.equals(bare.scrollbar), 'the scrollbar as with no fade').toBe(true)
  })
