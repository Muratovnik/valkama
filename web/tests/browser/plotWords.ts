/**
 * The words a chart shows on its own, as the browser lays them out, for a spec to hold to the rule
 * that no line stands over the plot and no row for changes is kept over it or under it (DESIGN.md,
 * `PeriodColumns`, `StepLine`): every word a chart shows stands in one of the regions its
 * component names for words — a legend, a scale, an axis, a head — and whatever else it has to
 * say is in a hint, which lies over the page outside the figure. Run in the page with
 * `page.evaluate(plotWords, { figure, regions, floor })` for the first figure the selector finds.
 *
 * It answers with the words that stand outside those regions; with what stands under the
 * `floor`, the region the figure ends on, as a row of marks without a word would; and with how
 * many words each region holds, so a spec can show the read found the chart's words at all.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

export interface PlotWordsAsked {
  /** The figure, by the hook its component documents. */
  figure: string
  /** The region the figure ends on: nothing it holds stands under it. */
  floor: string
  /** The regions a word may stand in, by their hooks. */
  regions: readonly string[]
}

export interface PlotWords {
  /** How many words each region holds, by its selector. */
  counted: Record<string, number>
  /** The words that stand in none of the regions. */
  stray: string[]
  /** What stands under the floor: each element by its tag and its first class. */
  under: string[]
}

/** Runs in the page: every function it uses is its own. */
export function plotWords({ figure, floor, regions }: PlotWordsAsked): PlotWords {
  const chart = document.querySelector(figure)
  if (!chart) throw new Error(`${figure} is not drawn`)
  const bottom = chart.querySelector(floor)?.getBoundingClientRect().bottom
  if (bottom === undefined) throw new Error(`${figure} has no ${floor}`)
  const counted = Object.fromEntries(regions.map((region) => [region, 0]))
  const stray: string[] = []
  const walker = document.createTreeWalker(chart, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const words = node.textContent?.trim() ?? ''
    const holder = node.parentElement
    if (!words || !holder) continue
    // Only what the reader sees: a text with no box of its own is not laid out.
    const range = document.createRange()
    range.selectNodeContents(node)
    if (![...range.getClientRects()].some((one) => one.width > 0 && one.height > 0)) continue
    const region = regions.find((one) => holder.closest(one))
    if (region) counted[region] = (counted[region] ?? 0) + 1
    else stray.push(words)
  }
  const under = [...chart.querySelectorAll('*')]
    .filter((element) => {
      const { height, top, width } = element.getBoundingClientRect()
      return width > 0 && height > 0 && top >= bottom - 0.5
    })
    .map((element) => `${element.tagName.toLowerCase()}.${element.classList[0] ?? ''}`)
  return { counted, stray, under }
}

/** The regions of a chart that hold words, those of them every such chart draws, and its floor. */
interface ChartWords {
  always: readonly string[]
  floor: string
  regions: readonly string[]
}

/** What a chart of periods (`PeriodColumns`) may hold words in, and the region it ends on. */
export const PERIOD_WORDS: ChartWords = {
  regions: ['[data-hint-list="legend"]', '[data-region="scale"]', '[data-region="axis"]'],
  always: ['[data-region="scale"]', '[data-region="axis"]'],
  floor: '[data-region="frame"]',
}

/** What a step line (`StepLine`) may hold words in, and the region it ends on. */
export const STEP_WORDS: ChartWords = {
  regions: ['[data-region="head"]', '[data-region="scale"]', '[data-region="axis"]'],
  always: ['[data-region="scale"]', '[data-region="axis"]'],
  floor: '[data-region="axis"]',
}

/**
 * Expects the chart `figure` finds to hold its words in its regions alone and nothing under its
 * floor: no line over the plot and no row for its changes over it or under it. The regions every
 * such chart draws, a scale's figures and an axis's names, are found by the same read, so it is
 * shown to read the chart's words at all.
 */
export async function expectNoLineOverPlot(
  page: Page,
  figure: string,
  { always, floor, regions }: ChartWords = PERIOD_WORDS,
) {
  const words = await page.evaluate(plotWords, { figure, floor, regions })
  expect(words.stray, `${figure}: words over or under the plot`).toEqual([])
  expect(words.under, `${figure}: a row under the plot`).toEqual([])
  for (const region of always)
    expect(words.counted[region], `${figure}: the words of ${region}`).toBeGreaterThan(0)
}
