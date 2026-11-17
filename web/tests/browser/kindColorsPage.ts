/**
 * The kind colours' browser-spec harness: a space holding every kind, the routes
 * of the views that show one, and how a test reads what the browser painted.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { installBackend } from './backend.ts'
import { spaceScope } from './planningFixtures.ts'
import { GOAL, KIND_SPACE, kindCard } from './served/kindColors.ts'
import type { Kind } from './served/kindColors.ts'
import { spaceAnswer } from './servedAnswers.ts'

/** The kinds' default colours, in the form a computed style reports them. */
export const DEFAULTS: Record<Kind, string> = {
  bug: 'rgb(255, 157, 181)',
  goal: 'rgb(207, 160, 255)',
  improvement: 'rgb(125, 239, 220)',
  task: 'rgb(180, 198, 224)',
}

const REFERENCE: Record<Kind, string> = {
  bug: 'MAIN-902',
  goal: 'MAIN-901',
  improvement: 'MAIN-903',
  task: 'MAIN-904',
}

/** A server for that space: its read model, and a card for whichever item is asked for. */
export async function serveKinds(page: Page) {
  await installBackend(page)
  await page.route('**/api/planning?*', (route) =>
    route.fulfill(spaceAnswer(new URL(route.request().url()).searchParams, KIND_SPACE)),
  )
  await page.route('**/api/modules/planning/work-item?*', (route) =>
    route.fulfill(kindCard(new URL(route.request().url()).searchParams.get('reference'))),
  )
}

const planningRoute = (view: string, state: Record<string, string> = {}) =>
  serializePlatformRoute({
    module_id: 'planning',
    scope: spaceScope,
    state: { view, ...state },
  })

export const SETTINGS = serializePlatformRoute({ module_id: 'settings', scope: spaceScope })

export async function openBoard(page: Page) {
  await page.goto(planningRoute('kanban', {}))
  await expect(tile(page, 'bug')).toBeVisible()
}

export async function openList(page: Page) {
  await page.goto(planningRoute('list'))
  await expect(row(page, 'bug')).toBeVisible()
}

export async function openGraph(page: Page) {
  await page.goto(planningRoute('graph'))
  await expect(page.locator('.graph-canvas.settled')).toBeVisible()
}

export async function openCard(page: Page, kind: Kind) {
  await openList(page)
  await row(page, kind).locator('.list-open').click()
  const drawer = page.locator('.drawer')
  await expect(drawer.locator('.identity-kind')).toBeVisible()
  return drawer
}

export const tile = (page: Page, kind: Kind) =>
  page.locator(`li[data-reference="${REFERENCE[kind]}"] .work-item-tile`)
export const row = (page: Page, kind: Kind) =>
  page.locator('.list-row', {
    has: page.locator(`.list-open[data-reference="${REFERENCE[kind]}"]`),
  })
export const node = (page: Page, kind: Kind) =>
  page.locator('.flow-node-card').filter({
    has: page.locator('.flow-node-id').getByText(REFERENCE[kind], { exact: true }),
  })
export const frame = (page: Page) => page.locator(`.graph-frame[data-frame="${GOAL}"]`)

export const glyphIn = (where: Locator) => where.locator('[data-facet="kind"] .facet-glyph')
export const wordIn = (where: Locator) => where.locator('[data-facet="kind"] .facet-word')

export interface Painted {
  /** The ground under it: every background up the tree, laid over one another. */
  ground: number[]
  ink: number[]
}

const channelsOf = (color: string) =>
  (color.match(/[\d.]+/gu) ?? []).map(Number).concat([1]).slice(0, 4)

/** What the browser paints an element in, and on what, as channels. */
export async function painted(element: Locator): Promise<Painted> {
  const { backgrounds, color } = await element.evaluate((start) => {
    const found: string[] = []
    for (let at: Element | null = start; at; at = at.parentElement)
      found.push(getComputedStyle(at).backgroundColor)
    return { backgrounds: found, color: getComputedStyle(start).color }
  })
  // The nearest opaque one, then whatever lies over it on the way back to the element.
  const layers = backgrounds.map((background) => channelsOf(background))
  const opaque = layers.findIndex((layer) => layer[3] === 1)
  let ground = [0, 0, 0]
  for (const [r = 0, g = 0, b = 0, a = 1] of layers.slice(0, opaque + 1).reverse())
    ground = [
      r * a + (ground[0] ?? 0) * (1 - a),
      g * a + (ground[1] ?? 0) * (1 - a),
      b * a + (ground[2] ?? 0) * (1 - a),
    ]
  return { ground, ink: channelsOf(color).slice(0, 3) }
}

function luminance(channels: number[]) {
  const [r = 0, g = 0, b = 0] = channels.map((channel) => {
    const unit = channel / 255
    return unit <= 0.04045 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG's contrast ratio, worked out here rather than asked of the product. */
export function contrastOf({ ground, ink }: Painted): number {
  const [high = 0, low = 0] = [luminance(ground), luminance(ink)].sort((a, b) => b - a)
  return (high + 0.05) / (low + 0.05)
}

export const colorOf = (element: Locator) =>
  element.evaluate((start) => getComputedStyle(start).color)

/**
 * The colour a kind's glyph has at the moment the first one is put in the page,
 * read before anything could be painted over it: the only moment a flash of the
 * default could be seen. Call it before the navigation.
 */
export async function watchFirstGlyph(page: Page, kind: Kind) {
  await page.addInitScript((wanted) => {
    const seen = new MutationObserver(() => {
      const glyph = document.querySelector(`[data-kind="${wanted}"] .facet-glyph`)
      if (!glyph) return
      seen.disconnect()
      ;(window as unknown as { firstGlyph: string }).firstGlyph = getComputedStyle(glyph).color
    })
    seen.observe(document, { childList: true, subtree: true })
  }, kind)
  return () => page.evaluate(() => (window as unknown as { firstGlyph?: string }).firstGlyph)
}

export { type Kind, KINDS } from './served/kindColors.ts'
