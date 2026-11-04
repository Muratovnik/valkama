/**
 * An epic's frame as the browser paints it: its header gives up the title and
 * never a count, its lines run over it, its edge says how far the work has come
 * in a forced palette too, and zoomed out the header still reads.
 *
 * Drawn on the harness's sample layout, so what is checked is the drawing, not
 * where the whole-space layout puts frames.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { expectNoSilentClipping } from './overflow.ts'
import { test } from './test.ts'

const surface = (lang: 'en' | 'ru', zoom = '') => {
  const query = new URLSearchParams({ surface: 'graph', lang })
  if (zoom) query.set('zoom', zoom)
  return `/tests/browser/harness.html?${query.toString()}`
}

async function settled(page: Page) {
  await expect(page.locator('.graph-flow.settled')).toBeVisible()
  await expect(page.locator('.graph-frame')).toHaveCount(3)
}

/** The long title's header: whether its title is cut, and whether any count is. */
async function longHeader(page: Page) {
  return page.locator('.graph-frame:not(.folded)').evaluate((frame) => {
    const title = frame.querySelector<HTMLElement>('.graph-frame-title')
    const head = frame.querySelector<HTMLElement>('.graph-frame-head')?.getBoundingClientRect()
    const counts = [...frame.querySelectorAll<HTMLElement>('.graph-frame-count')]
    return {
      titleCut: title !== null && title.scrollWidth > title.clientWidth,
      ellipsis: title === null ? '' : getComputedStyle(title).textOverflow,
      countsWhole: counts.every((count) => count.scrollWidth <= count.clientWidth),
      countsInside: counts.every((count) => {
        const box = count.getBoundingClientRect()
        return head !== undefined && box.left >= head.left && box.right <= head.right + 0.5
      }),
      counts: counts.length,
    }
  })
}

for (const [width, lang] of [
  [1500, 'en'],
  [1500, 'ru'],
  [390, 'en'],
  [390, 'ru'],
] as const) {
  test(`a frame cuts its title and none of its counts at ${width}px in ${lang}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 })
    await page.goto(surface(lang, 'read'))
    await settled(page)
    const header = await longHeader(page)
    expect(header).toMatchObject({
      titleCut: true,
      ellipsis: 'ellipsis',
      countsWhole: true,
      countsInside: true,
    })
    expect(header.counts).toBeGreaterThan(0)
    // Every frame draws its edge, open or folded.
    await expect(page.locator('.graph-frame .frame-progress')).toHaveCount(3)
    const scroll = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(scroll).toBeLessThanOrEqual(0)
    await expectNoSilentClipping(page, `graph frames at ${width}px in ${lang}`, '.graph-frame')
  })
}

test('the lines run over the frames and under the cards', async ({ page }) => {
  await page.goto(surface('en'))
  await settled(page)
  const layers = await page.evaluate(() => {
    // This body is serialized and evaluated in the page, so a module-scope
    // helper would not be in scope here.
    // eslint-disable-next-line unicorn/consistent-function-scoping -- see above
    const z = (element: Element | null) =>
      element === null ? Number.NaN : Number(getComputedStyle(element).zIndex)
    const frames = [...document.querySelectorAll('.vue-flow__node-frame')].map((node) => z(node))
    const cards = [...document.querySelectorAll('.vue-flow__node-card')].map((node) => z(node))
    const lines = [...document.querySelectorAll('.vue-flow__edges svg, svg.vue-flow__edges')].map(
      (line) => z(line),
    )
    return { frames, cards, lines }
  })
  expect(layers.frames).toHaveLength(3)
  const lowestLine = Math.min(...layers.lines.map((value) => (Number.isNaN(value) ? 0 : value)))
  for (const frame of layers.frames) expect(frame).toBeLessThan(lowestLine)
  for (const card of layers.cards) expect(card).toBeGreaterThanOrEqual(lowestLine)
})

test('folding a frame turns its chevron and says it can be expanded', async ({ page }) => {
  await page.goto(surface('en'))
  await settled(page)
  const fold = page.locator('.graph-frame:not(.folded) .graph-frame-fold')
  await expect(fold).toHaveAttribute('aria-expanded', 'true')
  const target = await fold.getAttribute('data-walk-target')
  await fold.click()
  const same = page.locator(`[data-walk-target="${target}"]`)
  await expect(same).toHaveAttribute('aria-expanded', 'false')
  await expect(same).toHaveAccessibleName(/^Expand epic /u)
})

for (const scheme of ['light', 'dark'] as const) {
  test(`in a forced ${scheme} palette the frame is outlined and its edge keeps finished from begun`, async ({
    page,
  }) => {
    await page.emulateMedia({ forcedColors: 'active', colorScheme: scheme })
    await page.goto(surface('en'))
    await settled(page)
    const paint = await page
      .locator('.graph-frame.folded')
      .first()
      .evaluate((frame) => {
        const edge = frame.querySelector<HTMLElement>('.frame-progress')
        const part = (name: string) => frame.querySelector<HTMLElement>(`[data-part="${name}"]`)
        const done = part('done')
        const active = part('active')
        const blocked = part('blocked')
        return {
          outline: getComputedStyle(frame).outlineStyle,
          ink: edge ? getComputedStyle(edge).color : '',
          done: done ? getComputedStyle(done).backgroundColor : '',
          begun: active ? getComputedStyle(active).borderTopStyle : '',
          blocked: blocked ? getComputedStyle(blocked).backgroundColor : '',
        }
      })
    expect(paint.outline).toBe('solid')
    expect(paint.done).toBe(paint.ink)
    expect(paint.begun).toBe('dashed')
    // Stopped work keeps no hue the palette took away: its count says it.
    expect(paint.blocked).toBe('rgba(0, 0, 0, 0)')
  })
}

test('zoomed out, a header is its reference over a thicker edge', async ({ page }) => {
  await page.goto(surface('ru', 'out'))
  await settled(page)
  const open = page.locator('.graph-frame:not(.folded)')
  await expect(open.locator('.graph-frame-reference')).toBeVisible()
  await expect(open.locator('.graph-frame-title')).toBeHidden()
  // The counts give way to the reference; work going on now is still said.
  await expect(open.locator('.graph-frame-count:not(.graph-frame-working)')).toHaveCount(0)
  await expect(open.locator('.graph-frame-working')).toBeVisible()
  const thickness = await open
    .locator('.frame-progress')
    .evaluate((edge) => edge.getBoundingClientRect().height)
  // 12px in the field's units at a third of the size: the 3px edge would be one.
  expect(thickness).toBeGreaterThan(3)
  // The work under no epic has no reference, so it keeps its name.
  await expect(page.locator('[data-frame="none"] .graph-frame-title')).toBeVisible()
})
