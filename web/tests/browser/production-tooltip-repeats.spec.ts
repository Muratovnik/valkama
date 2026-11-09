/**
 * What a hover hint says in the built application: never the words its anchor already shows.
 * Every hint states its kind; a `clipped` one shows only while its words are cut, so it is the
 * one hint allowed to say them, and the sweep leaves it out. The rest are swept by pointing at
 * every anchor on the board, the navigation and an opened card, in both languages.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { planningWorkItemEntity } from '@/shared/api/platformPlanningRefs.ts'
import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { richUsage, usageAnswer } from '../fixtures/usage.ts'
import { installBackend } from './backend.ts'
import { openBoard, serve } from './boardPage.ts'
import { drawnColours } from './contrast.ts'
import { heldCard, openPlanFor } from './openSessionFixtures.ts'
import { projectScope, workItemRef } from './planningFixtures.ts'
import { test } from './test.ts'

const CARD = serializePlatformRoute({
  module_id: 'planning',
  scope: projectScope,
  entity: planningWorkItemEntity(workItemRef),
})

type Locale = 'en' | 'ru'

const WORDS = {
  en: { action: 'Open in VS Code', state: 'running' },
  ru: { action: 'Открыть в VS Code', state: 'идёт' },
} as const

async function prepare(page: Page, locale: Locale, width: number) {
  await page.addInitScript((chosen) => localStorage.setItem('valkama-locale', chosen), locale)
  await page.setViewportSize({ width, height: 900 })
  // The hint's delay runs on this clock, so a test can say that no hint came after it.
  await page.clock.install()
}

async function board(page: Page, locale: Locale, width = 1280) {
  await prepare(page, locale, width)
  await installBackend(page)
  await serve(page)
  await openBoard(page)
}

async function card(page: Page, locale: Locale, width = 1280) {
  await prepare(page, locale, width)
  await installBackend(page, { card: heldCard, openPlan: openPlanFor })
  await page.route('**/api/planning/work-item/usage?*', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(usageAnswer(richUsage())),
    }),
  )
  await page.goto(CARD)
  const drawer = page.locator('.drawer')
  await expect(drawer.locator('.card-facts .card-row-value')).toBeVisible()
  await expect(drawer.locator('.usage-line')).toBeVisible()
  await expect(drawer).toHaveCSS('transform', 'none')
  return drawer
}

interface Shown {
  hint: string
  kind: string
  visible: string
}

/**
 * The hint showing under the pointer at `x, y`, its anchor's kind and the words the anchor
 * shows. A word inside a box cut to nothing, a hidden or a transparent one is not shown.
 */
function readShown([x, y]: [number, number]): Shown | null {
  const hint = document.querySelector('.tooltip-hint')
  const anchor = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-tooltip]')
  if (!hint || !anchor) return null
  // The hint's own words, without the state under them or the copy read to assistive technology.
  const main = hint.cloneNode(true) as HTMLElement
  for (const extra of main.querySelectorAll('.tooltip-note, [role="tooltip"]')) extra.remove()
  const seen = (node: Text) => {
    for (let at = node.parentElement; at; at = at.parentElement) {
      const style = getComputedStyle(at)
      const box = at.getBoundingClientRect()
      if (!at.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return false
      if (style.clipPath !== 'none' || (style.clip !== 'auto' && style.clip !== '')) return false
      if (box.width <= 1 || box.height <= 1) return false
      if (at === anchor) return true
    }
    return true
  }
  const words: string[] = []
  const walker = document.createTreeWalker(anchor, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode())
    if (seen(node as Text)) words.push(node.textContent ?? '')
  return {
    hint: main.textContent ?? '',
    kind: anchor.dataset.tooltipKind ?? '',
    visible: words.join(' '),
  }
}

const tokens = (text: string) =>
  text
    .toLowerCase()
    .split(/\s+/u)
    .map((word) => word.replaceAll(/^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu, ''))
    .filter(Boolean)

/** Whether `part` stands, word for word and in order, inside `whole`. */
function within(part: string[], whole: string[]) {
  if (part.length === 0 || part.length > whole.length) return false
  for (let start = 0; start + part.length <= whole.length; start += 1)
    if (part.every((word, index) => whole[start + index] === word)) return true
  return false
}

const repeats = ({ hint, visible }: Shown) => {
  const [said, shown] = [tokens(hint), tokens(visible)]
  return within(shown, said) || within(said, shown)
}

/** Point at every anchor on screen inside `where` and list each hint that says its words. */
async function sweep(page: Page, where: Locator) {
  const viewport = page.viewportSize() ?? { width: 0, height: 0 }
  const anchors = where.locator('[data-tooltip]')
  const said: string[] = []
  let pointed = 0
  for (let index = 0, count = await anchors.count(); index < count; index += 1) {
    const box = await anchors.nth(index).boundingBox()
    if (!box || box.width < 2 || box.height < 2) continue
    const point: [number, number] = [box.x + box.width / 2, box.y + box.height / 2]
    if (point[0] < 0 || point[1] < 0 || point[0] > viewport.width || point[1] > viewport.height)
      continue
    await page.mouse.move(...point)
    await page.clock.runFor(1000)
    const shown = await page.evaluate(readShown, point)
    if (!shown) continue
    pointed += 1
    if (shown.kind !== 'clipped' && repeats(shown))
      said.push(`${shown.kind || 'no kind'}: «${shown.visible.trim()}» → «${shown.hint}»`)
  }
  return { pointed, said }
}

for (const locale of ['en', 'ru'] as const) {
  test(`no hint on the board or the navigation says what its anchor shows, ${locale}`, async ({
    page,
  }) => {
    await board(page, locale)
    const { pointed, said } = await sweep(page, page.locator('.app-nav-shell, .work-item-board'))
    expect(pointed).toBeGreaterThan(2)
    expect(said).toEqual([])
  })

  test(`no hint on an opened card says what its anchor shows, ${locale}`, async ({ page }) => {
    const drawer = await card(page, locale)
    const { pointed, said } = await sweep(page, drawer)
    expect(pointed).toBeGreaterThan(2)
    expect(said).toEqual([])
  })
}

const hint = (page: Page) => page.locator('.tooltip-hint')

async function pointAt(page: Page, target: Locator) {
  await target.scrollIntoViewIfNeeded()
  await target.hover()
  await page.clock.runFor(1000)
}

for (const width of [1280, 390] as const)
  for (const locale of ['en', 'ru'] as const) {
    test(`a tile and its label chip show no hint at ${width}px, ${locale}`, async ({ page }) => {
      await board(page, locale, width)
      const sheet = page.locator('[data-reference="MAIN-430"] .work-item-tile')
      await pointAt(page, sheet.locator('.tile-title'))
      await expect(hint(page)).toHaveCount(0)
      await pointAt(page, sheet.locator('.label-chip').first())
      await expect(hint(page)).toHaveCount(0)
    })

    test(`the executor hints one action over a quiet state, and the usage line none, at ${width}px, ${locale}`, async ({
      page,
    }) => {
      const drawer = await card(page, locale, width)
      const button = drawer.locator('.card-holder button.open-action')
      const shown = await button.locator('.open-action-name').textContent()
      const name = shown?.trim() ?? ''
      expect(name).not.toBe('')
      await pointAt(page, button)
      await expect(hint(page)).toBeVisible()
      const note = hint(page).locator('.tooltip-note')
      await expect(note).toHaveText(WORDS[locale].state)
      const lines = await hint(page).evaluate((node) => {
        const text = [...node.childNodes].find(
          (child) => child.nodeType === Node.TEXT_NODE && child.textContent?.trim(),
        )
        const range = document.createRange()
        range.selectNodeContents(text ?? node)
        const action = range.getClientRects()
        const below = node.querySelector('.tooltip-note')?.getBoundingClientRect()
        return {
          action: text?.textContent?.trim() ?? '',
          actionLines: new Set([...action].map((rect) => Math.round(rect.top))).size,
          actionBottom: Math.max(...[...action].map((rect) => rect.bottom)),
          noteLines: Math.round(
            (below?.height ?? 0) / Number.parseFloat(getComputedStyle(node).lineHeight),
          ),
          noteTop: below?.top ?? 0,
        }
      })
      // One line for what a press does, the state on its own line under it.
      expect(lines.action).toBe(WORDS[locale].action)
      expect(lines.actionLines).toBe(1)
      expect(lines.noteLines).toBe(1)
      expect(lines.noteTop).toBeGreaterThanOrEqual(lines.actionBottom - 1)
      // The holder's name is on the button, so the hint never says it.
      await expect(hint(page)).not.toContainText(name)
      await expect(hint(page)).not.toContainText('coordinator')
      // The state is in the quiet ink, still legible on the hint's ground.
      const [quiet, main] = await Promise.all([
        note.evaluate((node) => getComputedStyle(node).color),
        hint(page).evaluate((node) => getComputedStyle(node).color),
      ])
      expect(quiet).not.toBe(main)
      const drawn = await note.evaluate(drawnColours, 'own' as const)
      expect(drawn.contrast).toBeGreaterThanOrEqual(4.5)

      await pointAt(page, drawer.locator('.usage-line'))
      await expect(hint(page)).toHaveCount(0)
    })
  }
