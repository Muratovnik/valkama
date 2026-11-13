/**
 * A pair's name keeps its second part whole, in the real app, in the «Model» section split by
 * «Effort», in English and in Russian, at 1280 by 800 and 1440 by 900 and at the widths DESIGN.md
 * names for the page's layout: 1024, where the bar is two rows; 1107 and 1108, either side of the
 * bar's 50rem; 1200 and 1300, the ends of the band its one line was measured over. A name that
 * does not fit cuts its first part, the model, and the separator and the effort stand whole after
 * it, «claude-opus-5-… · medium»: cut from its end, «claude-opus-5-5 · …» stood twice in the bars
 * at 1440 in English, and two rows read as one.
 *
 * In the bars, the small charts' names, the day chart's legend and the table, every name is its
 * whole pair, and the separator and the second part are inside every box that clips them. The
 * bars at 1440 in English are cut, so the run holds the cut case and not only names that fit. A
 * cut name is said whole in its hint, and each name of the table, its row's control, is named by
 * its whole pair, as a cut one is too. Each run prints what it measured.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { value } from '../fixtures/analytics.ts'
import type { TimedStretch } from '../fixtures/analytics.ts'
import { openReport, pageAt, record, serve } from './analyticsPage.ts'
import { test } from './test.ts'

const HOUR = 3600
const at = (day: number) => new Date(2026, 10, day, 10)

/** One stretch of a model at an effort, `hours` long, on a day of November. */
const stretch = (day: number, model: string, effort: string, hours: number): TimedStretch => ({
  at: at(day),
  group: { model: value(model), effort: value(effort) },
  spend: { seconds: hours * HOUR },
})

/** The week so far, five pairs of three models at two efforts, largest first as `PAIRS`. */
const WORLD: TimedStretch[] = [
  stretch(9, 'claude-opus-5-5', 'high', 4),
  stretch(9, 'claude-sonnet-5-5', 'medium', 1),
  stretch(10, 'claude-opus-5-5', 'high', 2),
  stretch(10, 'claude-opus-5-5', 'medium', 3),
  stretch(11, 'claude-sonnet-5-5', 'high', 2),
  stretch(11, 'claude-haiku-5-5', 'high', 0.5),
]

const PAIRS = [
  'claude-opus-5-5 · high',
  'claude-opus-5-5 · medium',
  'claude-sonnet-5-5 · high',
  'claude-sonnet-5-5 · medium',
  'claude-haiku-5-5 · high',
]

const SPLIT = pageAt({ by: 'model', across: 'effort' })

/** Where a pair's name stands on the page, by what the run calls each place. */
const PLACES = {
  bars: '.spending-bars .ranked-label',
  multiples: '.spending-multiples .multiple-name',
  legend: '.spending-days .chart-key-name',
  table: '.spending-table tbody th .table-name',
} as const

/** The window sizes: the two the change was reported at, and the widths of the page's bands. */
const SIZES = [
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
  ...[1024, 1107, 1108, 1200, 1300].map((width) => ({ width, height: 900 })),
]

/** The split section open in `locale` at a window size, with its pairs read. */
async function openPairs(page: Page, locale: 'en' | 'ru', size: (typeof SIZES)[number]) {
  await page.addInitScript((chosen) => localStorage.setItem('valkama-locale', chosen), locale)
  await serve(page, WORLD)
  await openReport(page, size.width, SPLIT)
  await page.setViewportSize(size)
  await expect(page.locator(PLACES.legend)).toHaveCount(PAIRS.length)
  await expect(page.locator(PLACES.bars).first()).toHaveText(PAIRS[0] ?? '')
  await page.evaluate(() => document.fonts.ready)
  await page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  )
}

/**
 * Each name a selector finds: its words, whether they are cut — the text of its words laid out
 * whole is wider than its box — and how many pixels of the separator and the second part stand
 * outside a box that clips them, from the name's text up to the name. The words are measured on
 * ranges over the characters, so it holds whatever elements the name is drawn with.
 */
async function names(page: Page, selector: string) {
  return page.evaluate((chosen) => {
    const SEPARATOR = ' · '
    /** The text nodes of an element with the offset each starts at in its text. */
    const textNodes = (element: Element) => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
      const found: { from: number; node: Text }[] = []
      let from = 0
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        found.push({ node: node as Text, from })
        from += node.textContent?.length ?? 0
      }
      return found
    }
    /** A range over characters `from` to `to` of an element's text. */
    function rangeOf(element: Element, from: number, to: number) {
      const range = document.createRange()
      for (const { node, from: start } of textNodes(element)) {
        const end = start + node.length
        if (from >= start && from <= end) range.setStart(node, from - start)
        if (to >= start && to <= end) {
          range.setEnd(node, to - start)
          break
        }
      }
      return range
    }
    return [...document.querySelectorAll<HTMLElement>(chosen)].map((name) => {
      const text = name.textContent ?? ''
      const words = text.trim()
      const box = name.getBoundingClientRect()
      let whole = 0
      for (const { node } of textNodes(name)) {
        const range = document.createRange()
        range.selectNodeContents(node)
        whole += range.getBoundingClientRect().width
      }
      const style = getComputedStyle(name)
      let room = box.width
      for (const side of [
        'paddingLeft',
        'paddingRight',
        'borderLeftWidth',
        'borderRightWidth',
      ] as const)
        room -= Number.parseFloat(style[side])
      const separator = text.lastIndexOf(SEPARATOR)
      if (separator < 0) return { words, cut: whole > room + 0.5, hidden: null }
      // From the separator's dot to the last character of the second part.
      const end = rangeOf(name, separator + 1, text.trimEnd().length)
      const part = end.getBoundingClientRect()
      let left = -Infinity
      let right = Infinity
      for (let clip = end.startContainer.parentElement; clip; clip = clip.parentElement) {
        const style = getComputedStyle(clip)
        if (style.overflowX !== 'visible') {
          // Its padding box, to the fraction of a pixel that `clientWidth` rounds away.
          const edges = clip.getBoundingClientRect()
          left = Math.max(left, edges.left + Number.parseFloat(style.borderLeftWidth))
          right = Math.min(right, edges.right - Number.parseFloat(style.borderRightWidth))
        }
        if (clip === name) break
      }
      const hidden = Math.max(0, part.right - right) + Math.max(0, left - part.left)
      return {
        words,
        cut: whole > room + 0.5,
        hidden: Math.round(hidden * 1000) / 1000,
        end: Math.round(part.width * 100) / 100,
      }
    })
  }, selector)
}

type Measured = Awaited<ReturnType<typeof names>>

/**
 * The hint the first cut name of a place shows under the pointer, with the pair it names; null
 * where no name of the place is cut.
 */
async function hintOfCut(page: Page, place: Locator, found: Measured) {
  const index = found.findIndex((one) => one.cut)
  if (index < 0) return null
  await page.mouse.move(0, 0)
  await expect(page.getByRole('tooltip')).toBeHidden()
  await place.nth(index).hover()
  const hint = page.getByRole('tooltip')
  await expect(hint).toBeVisible()
  return { pair: found[index]?.words ?? '', hint: (await hint.textContent()) ?? '' }
}

/** The places whose cut name has a hint that does not say its whole pair. */
const hintsShort = (hints: Record<string, Awaited<ReturnType<typeof hintOfCut>>>) =>
  Object.entries(hints)
    .filter(([, one]) => one && !one.hint.includes(one.pair))
    .map(([where]) => where)

/**
 * Whether the bars hold a cut name where the change was reported, in English at 1440, so the run
 * holds the cut case; elsewhere a name may fit or not, and nothing is held.
 */
const cutWhereReported = (locale: string, width: number, bars: Measured) =>
  locale !== 'en' || width !== 1440 || bars.some((one) => one.cut)

for (const locale of ['en', 'ru'] as const)
  for (const size of SIZES)
    test(`in ${locale} at ${size.width}×${size.height}, a pair's name keeps its second part whole`, async ({
      page,
    }, info) => {
      await openPairs(page, locale, size)
      const measured = {
        bars: await names(page, PLACES.bars),
        multiples: await names(page, PLACES.multiples),
        legend: await names(page, PLACES.legend),
        table: await names(page, PLACES.table),
      }
      const hints: Record<string, Awaited<ReturnType<typeof hintOfCut>>> = {}
      for (const [where, found] of Object.entries(measured)) {
        const place = page.locator(PLACES[where as keyof typeof PLACES])
        hints[where] = await hintOfCut(page, place, found)
      }
      await record(info, `pair names ${locale} ${size.width}`, { ...measured, hints })

      for (const [where, found] of Object.entries(measured)) {
        // Every place names every pair whole, in the order of the bars.
        expect(
          found.map((one) => one.words),
          where,
        ).toEqual(PAIRS)
        // The separator and the second part stand inside every box that clips them.
        for (const one of found) expect(one.hidden, `${where}: ${one.words}`).toBe(0)
      }
      // A cut name says its whole pair in its hint.
      expect(hintsShort(hints)).toEqual([])
      // The case the change is for: in English at 1440 the bars' names are cut.
      expect(cutWhereReported(locale, size.width, measured.bars)).toBe(true)

      // Each name of the table is its row's control, named by its whole pair, cut or not.
      const presses = page.locator('.spending-table tbody th .chart-press')
      await expect(presses).toHaveCount(PAIRS.length)
      for (const [index, pair] of PAIRS.entries())
        await expect(presses.nth(index)).toHaveAccessibleName(pair)
    })
