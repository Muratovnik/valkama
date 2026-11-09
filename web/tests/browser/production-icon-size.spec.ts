/**
 * Every icon is the size it is drawn at, and a one-line label stays on one line, in the built
 * application: on the board with the navigation's live work and its quiet work unfolded, on
 * the portfolio, on a card, its «…» menu, its Relations with the chain and its `@` list, and on
 * a question's review, at a desktop width, at a phone's and with the navigation at its
 * narrowest, in both languages.
 *
 * An icon in a row short of room used to give way: a flex item shrinks, and the page's
 * `svg { max-width: 100% }` lets a drawing go narrower than its box. A label with no rule of its
 * own wrapped under itself. Both are read off the page by measurement, not by the rules.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { planningWorkItemEntity } from '@/shared/api/platformPlanningRefs.ts'
import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { busyFrame } from '../support/liveFrame.ts'
import { wayReviewFields, WAYS_PROMPT } from '../support/reviewWays.ts'
import { installBackend } from './backend.ts'
import { openBoard, serve } from './boardPage.ts'
import { serve as serveChain, smallChain } from './chainFixtures.ts'
import { openMentionList } from './editorPage.ts'
import { installLiveStreams } from './liveWorkPage.ts'
import { globalScope, projectScope, workItemRef } from './planningFixtures.ts'
import { asked, openQuestion } from './questionBackend.ts'
import { test } from './test.ts'

type Locale = 'en' | 'ru'
type Width = 'desktop' | 'narrowest navigation' | 'phone'

const VIEWPORTS: Record<Width, number> = {
  'desktop': 1280,
  'narrowest navigation': 1280,
  'phone': 390,
}

const CARD = serializePlatformRoute({
  module_id: 'planning',
  scope: projectScope,
  entity: planningWorkItemEntity(workItemRef),
})
const PORTFOLIO = serializePlatformRoute({ module_id: 'planning', scope: globalScope })

/** The navigation's least width, which `Home` on its edge sets. */
const NARROWEST = 200

/** Labels that are one line by design, whatever their component calls them. */
const ONE_LINE_LABELS = '.one-line, .work-action .action-label'

async function prepare(page: Page, locale: Locale, width: Width) {
  await page.addInitScript((chosen) => localStorage.setItem('valkama-locale', chosen), locale)
  await page.setViewportSize({ width: VIEWPORTS[width], height: 900 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
}

/** The navigation as narrow as it goes, once it stands. */
async function narrowest(page: Page, width: Width) {
  if (width !== 'narrowest navigation') return
  const rail = page.locator('.app-nav-shell')
  await page.getByRole('separator', { name: /Navigation width|Ширина навигации/u }).focus()
  await page.keyboard.press('Home')
  await expect
    .poll(() => rail.evaluate((node) => node.getBoundingClientRect().width))
    .toBe(NARROWEST)
  await page.mouse.move(0, 0)
}

/** The navigation's live work, its groups, rows and pins, over a page `open` goes to. */
async function withLiveWork(page: Page, open: () => Promise<void>) {
  const streams = await installLiveStreams(page)
  await open()
  await expect.poll(() => streams.open()).toHaveLength(1)
  await streams.live(busyFrame())
  // A phone keeps the navigation behind its menu; the frame is in it all the same.
  if ((page.viewportSize()?.width ?? 0) > VIEWPORTS.phone)
    await expect(page.locator('.nav-work-list')).toBeVisible()
}

/**
 * The board narrowed by two labels, so its filter draws its chips and their removes, and the
 * navigation's quiet work unfolded where the navigation stands.
 */
async function board(page: Page) {
  await installBackend(page)
  await serve(page)
  await withLiveWork(page, () => openBoard(page, { group: 'epic', labels: 'coordinator,ui' }))
  await expect(page.locator('.workspace-chips .filter-chip').first()).toBeVisible()
  const fold = page.locator('.nav-quiet-fold').first()
  if (await fold.isVisible()) {
    await fold.click()
    await expect(fold).toHaveAttribute('aria-expanded', 'true')
  }
}

/** The board showing one epic's chain, which its scope chip says and leaves. */
async function chain(page: Page) {
  await installBackend(page)
  await serve(page)
  await openBoard(page, { group: 'epic', chain: 'MAIN-401', chain_scope: 'chain' })
  await expect(page.locator('.scope-chip')).toBeVisible()
}

async function portfolio(page: Page) {
  await installBackend(page)
  await withLiveWork(page, async () => {
    await page.goto(PORTFOLIO)
  })
  await expect(page.locator('.portfolio-project').first()).toBeVisible()
}

async function card(page: Page, before?: () => Promise<unknown>) {
  await installBackend(page)
  await before?.()
  await page.goto(CARD)
  const drawer = page.locator('.drawer')
  await expect(drawer.locator('.card-facts .card-row-value')).toBeVisible()
  await expect(drawer).toHaveCSS('transform', 'none')
}

/** The card's links, each with the press that removes it, and the chain under them. */
async function links(page: Page) {
  const small = smallChain()
  await card(page, () => serveChain(page, small.chain, small.items))
  await page.getByRole('tab', { name: /Relations|Связи/u }).click()
  await expect(page.locator('.drawer .relations svg.lucide').first()).toBeVisible()
  await expect(page.locator('.drawer section.chain .chain-row').first()).toBeVisible()
}

/** The card's «…» open, its entries with their signs and the pin's check. */
async function menu(page: Page) {
  // The menu holds the pin, which a live frame says.
  const live: { streams?: Awaited<ReturnType<typeof installLiveStreams>> } = {}
  await card(page, async () => {
    live.streams = await installLiveStreams(page)
  })
  await expect.poll(() => live.streams?.open()).toHaveLength(1)
  await live.streams?.live(busyFrame())
  await page.locator('.drawer .menu-trigger').click()
  await expect(page.locator('.menu-popup .menu-item').first()).toBeVisible()
}

/** A comment's `@` list, a task's row and a file's whose path is longer than the list. */
async function mentions(page: Page) {
  await openMentionList(page)
}

async function review(page: Page) {
  const opened = await openQuestion(page, [
    asked({ prompt: WAYS_PROMPT, fields: wayReviewFields, title: 'Review of the board' }),
  ])
  await expect(opened.card.locator('.request-point')).toHaveCount(12)
  await expect(opened.drawer).toHaveCSS('transform', 'none')
}

const SCENES = { board, chain, portfolio, card, links, menu, mentions, review } as const

/** Every icon on the page whose box differs from the size it is drawn at, and how many stand. */
function measureIcons() {
  // This body is serialized and evaluated in the page, so a module-scope helper is not there.
  // eslint-disable-next-line unicorn/consistent-function-scoping -- see above
  const where = (node: Element) =>
    [
      [...(node.parentElement?.closest('[class]')?.classList ?? [])].join('.'),
      [...node.classList].find((name) => name.startsWith('lucide-')),
    ].join(' ')
  const shrunk: string[] = []
  let shown = 0
  for (const svg of document.querySelectorAll('svg.lucide')) {
    const box = svg.getBoundingClientRect()
    if (!svg.checkVisibility({ visibilityProperty: true }) || box.width + box.height === 0) continue
    shown += 1
    // A glyph's drawing is square and centred in its box, so it is drawn as large as the box's
    // shorter side: a box one line tall around a 16px glyph still draws it at 16.
    const size = Number(svg.getAttribute('width'))
    if (Math.abs(Math.min(box.width, box.height) - size) > 0.5)
      shrunk.push(`${where(svg)}: ${box.width.toFixed(1)}×${box.height.toFixed(1)} of ${size}`)
  }
  const rail = document.querySelector('.app-nav-shell')
  return { navigation: Math.round(rail?.getBoundingClientRect().width ?? 0), shown, shrunk }
}

/** Every one-line label that takes more than one line, and every cut one with no hint. */
function measureLabels(labels: string) {
  const wrapped: string[] = []
  const unhinted: string[] = []
  let shown = 0
  for (const label of document.querySelectorAll<HTMLElement>(labels)) {
    const words = label.textContent?.trim() ?? ''
    if (!label.checkVisibility({ visibilityProperty: true }) || !words) continue
    shown += 1
    const range = document.createRange()
    range.selectNodeContents(label)
    const lines = new Set([...range.getClientRects()].map((rect) => Math.round(rect.bottom)))
    if (lines.size > 1) wrapped.push(`«${words}»: ${lines.size} lines`)
    const cut = label.clientWidth > 1 && label.scrollWidth > label.clientWidth + 1
    if (cut && !label.closest('[data-tooltip]')) unhinted.push(`«${words}»`)
  }
  return { shown, unhinted, wrapped }
}

for (const width of Object.keys(VIEWPORTS) as Width[])
  for (const locale of ['en', 'ru'] as const)
    for (const [scene, open] of Object.entries(SCENES))
      test(`every icon keeps its size and a label its line on the ${scene}, ${width}, ${locale}`, async ({
        page,
      }) => {
        await prepare(page, locale, width)
        await open(page)
        await narrowest(page, width)
        await page.evaluate(async () => document.fonts.ready)
        const icons = await page.evaluate(measureIcons)
        const labels = await page.evaluate(measureLabels, ONE_LINE_LABELS)
        expect(icons.shown).toBeGreaterThan(5)
        expect({
          shrunk: icons.shrunk,
          wrapped: labels.wrapped,
          unhinted: labels.unhinted,
        }).toEqual({ shrunk: [], wrapped: [], unhinted: [] })
      })
