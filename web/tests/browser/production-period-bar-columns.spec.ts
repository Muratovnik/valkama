/**
 * The periods of a page's bar, in Analytics, Agent decisions and Volumes, at every width from a
 * phone to 1280px and back, in both languages. The oracle is DESIGN.md (Segmented choice;
 * Analytics, the bar): where one line has no room for the periods they wrap in columns of one
 * width, every line but the last full and each period under the one at its place on the first
 * line, in the fewest columns that keep to that many lines; the page never scrolls sideways and the
 * period chosen stands in the window. Wrapped by the bar itself, each line shared its own room and
 * the breaks of two lines missed each other: at 390px Analytics' five stood three over two, and
 * the four of Agent decisions and Volumes three over one. On a phone each period chosen in turn
 * leaves the lines as they were.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { volumesAnswer } from '../support/volumesDouble.ts'
import { pageAt, serve } from './analyticsPage.ts'
import { installBackend } from './backend.ts'
import { spaceScope } from './planningFixtures.ts'
import { missesOf, segmentLines } from './segmentLines.ts'
import { test } from './test.ts'

const LABEL = { en: 'Period', ru: 'Период' } as const
const TRACK = (locale: keyof typeof LABEL) => `[role="radiogroup"][aria-label="${LABEL[locale]}"]`
const WIDTHS = [390, 430, 480, 600, 768, 1024, 1280, 1024, 768, 600, 480, 430, 390] as const

/** Each page with its periods, `Custom` last, and how it is opened against the doubles. */
const PAGES = {
  analytics: {
    periods: 5,
    open: async (page: Page) => {
      await serve(page)
      await page.goto(pageAt())
    },
  },
  decisions: {
    periods: 4,
    open: async (page: Page) => {
      await installBackend(page)
      await page.goto(
        serializePlatformRoute({ module_id: 'decisions', scope: spaceScope, state: {} }),
      )
    },
  },
  volumes: {
    periods: 4,
    open: async (page: Page) => {
      await installBackend(page)
      // Routed after the backend's own, so these answer.
      await page.route('**/api/planning/volumes?*', (route) =>
        route.fulfill({ json: volumesAnswer() }),
      )
      await page.route('**/api/planning/commits/unattached?*', (route) =>
        route.fulfill({ json: { total: 0, items: [] } }),
      )
      await page.goto(
        serializePlatformRoute({ module_id: 'volumes', scope: spaceScope, state: {} }),
      )
    },
  },
} as const

/** Whether the page scrolls sideways, and whether the period chosen stands in the window. */
const windowOf = (page: Page, track: string) =>
  page.evaluate((selector) => {
    const root = document.scrollingElement ?? document.documentElement
    const chosen = document.querySelector(`${selector} [aria-checked="true"]`)
    const box = chosen?.getBoundingClientRect()
    return {
      sideways: root.scrollWidth > root.clientWidth,
      chosen: box ? box.left >= 0 && box.right <= root.clientWidth + 0.5 : null,
    }
  }, track)

/** How many lines the periods stand on. */
async function lineCount(page: Page, track: string) {
  const [periods] = await segmentLines(page, [track])
  return periods?.lines.length ?? 0
}

/** The lines' misses, with the page's sideways scroll and a chosen period out of the window. */
async function misses(page: Page, track: string) {
  const [periods] = await segmentLines(page, [track])
  const shown = await windowOf(page, track)
  return [
    ...(periods ? missesOf(periods) : ['no periods']),
    ...(shown.sideways ? ['the page scrolls sideways'] : []),
    ...(shown.chosen === true ? [] : [`the period chosen in the window: ${shown.chosen}`]),
  ]
}

for (const [name, { periods, open }] of Object.entries(PAGES))
  for (const locale of ['en', 'ru'] as const)
    test(`the periods of ${name} line their lines up at every width in ${locale}`, async ({
      page,
    }) => {
      await page.addInitScript((chosen) => localStorage.setItem('valkama-locale', chosen), locale)
      await page.setViewportSize({ width: 390, height: 844 })
      await open(page)
      const track = TRACK(locale)
      const radios = page.locator(`${track} [role="radio"]`)
      await expect(radios).toHaveCount(periods)
      await page.evaluate(() => document.fonts.ready)
      // The periods do not fit one line of a phone's bar: the case this is about.
      await expect.poll(() => lineCount(page, track)).toBeGreaterThan(1)
      for (const width of WIDTHS) {
        await page.setViewportSize({ width, height: 844 })
        await expect
          .poll(() => misses(page, track), { message: `${name} ${locale} at ${width}px` })
          .toEqual([])
      }
      // Each period but the reader's own, chosen in turn on the phone, keeps the lines lined up.
      for (let at = 0; at < periods - 1; at += 1) {
        await radios.nth(at).click()
        await expect(radios.nth(at)).toHaveAttribute('aria-checked', 'true')
        await expect
          .poll(() => misses(page, track), { message: `${name} ${locale}, period ${at}` })
          .toEqual([])
      }
    })
