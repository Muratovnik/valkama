/**
 * A choice at the end of a section's heading row against the row, on a phone, in the built app
 * (`PanelLevel`, `SegmentedControl`'s `wrap`). The oracle is the owner's rule for narrow widths:
 * at 390 and 320 pixels nothing breaks — no sideways scroll, nothing past an edge, nothing
 * covered, the focus visible. A row of choices wider than the line it takes in the heading row
 * wraps to keep to it (DESIGN.md, Segmented choice), each choice whole: the pauses' three waits
 * stood 248px wide in a heading row of 224 at 320 pixels in Russian, and scrolled the panel 14px
 * sideways; the three views of a chart split into parts ran 8px past their column.
 *
 * Every section of the page that holds a choice in its heading rows is opened at 390 and 320
 * pixels in both languages, with the scrollbars a desktop draws. Each choice there
 * (`data-level-actions`, the radio group) stands inside its heading row (`data-level-head`), each
 * of its segments inside the row and its words whole, a choice that wraps across the whole row in
 * columns on the fewest lines the row allows (`SegmentedControl`), and the panel does not scroll
 * sideways: wrapped in a box only as wide as what it holds, the chart's three views stood in one
 * column of three, 82px wide in a row of 224. The pauses' waits are walked with the keyboard: the
 * focus ring stands on a segment inside the row, and the choice moves with it. A choice that
 * wrapped stands on one line again once the window is wide. Each run attaches what it measured.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { PAUSES, pausesAnswer } from '../fixtures/pauses.ts'
import { openPanel, record, serve } from './analyticsPage.ts'
import { globalScope } from './planningFixtures.ts'
import { test } from './test.ts'

// Playwright hides scrollbars; the panel's own takes room a desktop's screen gives it.
test.use({ launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] } })

const softly = expect.configure({ soft: true })

/** How far two edges may stand apart and still be one place: the layout's rounding. */
const NEAR = 0.5

/** The sections with a choice in a heading row, by the address part that opens each. */
const SECTIONS = [
  'pauses',
  'token_kind',
  'quota_five_hour',
  'quota_week',
  'seat',
  'account',
  'project',
  'work_item',
  'executor',
  'role',
  'launch_class',
  'model',
  'effort',
  'environment',
] as const

/** The pauses' waits in each language, in their order. */
const WAITS = {
  en: ['Machine', 'Person', 'Wakes'],
  ru: ['Машина', 'Человек', 'Разбудки'],
} as const

/** Each choice in a heading row and its segments, against the row, and the panel's sideways room. */
const measured = (page: Page) =>
  page.evaluate((near) => {
    const panel = document.querySelector<HTMLElement>('.analytics-panel')
    const choices = [
      ...document.querySelectorAll<HTMLElement>(
        '.analytics-panel [data-level-head] > [data-level-actions] [role="radiogroup"]',
      ),
    ]
      .filter((choice) => choice.checkVisibility())
      .map((choice) => {
        const row = choice.closest('[data-level-head]')?.getBoundingClientRect() ?? new DOMRect()
        const box = choice.getBoundingClientRect()
        const segments = [...choice.querySelectorAll<HTMLElement>('[role="radio"]')].map(
          (segment) => {
            const own = segment.getBoundingClientRect()
            const range = document.createRange()
            range.selectNodeContents(segment)
            const words = range.getBoundingClientRect()
            const style = getComputedStyle(segment)
            const room =
              own.width -
              Number.parseFloat(style.paddingLeft) -
              Number.parseFloat(style.paddingRight)
            return {
              text: segment.textContent.trim(),
              inside: own.left >= row.left - near && own.right <= row.right + near,
              whole: words.width <= room + near,
            }
          },
        )
        const lines = new Set(
          [...choice.querySelectorAll('[role="radio"]')].map((segment) =>
            Math.round(segment.getBoundingClientRect().top),
          ),
        ).size
        return {
          label: choice.getAttribute('aria-label') ?? '',
          width: box.width,
          row: row.width,
          lines,
          inside: box.left >= row.left - near && box.right <= row.right + near,
          // A row that wraps stands across the heading row, on the fewest lines its room allows.
          across: lines === 1 || Math.abs(box.width - row.width) <= near,
          segments,
        }
      })
    return {
      choices,
      scroll: panel ? `${panel.scrollWidth}/${panel.clientWidth}` : null,
      sideways: panel ? panel.scrollWidth > panel.clientWidth : null,
    }
  }, NEAR)

/** Whether every choice measured stands inside its row. */
const everyInside = (seen: Awaited<ReturnType<typeof measured>>) =>
  seen.choices.every((one) => one.inside)

async function open(page: Page, section: string) {
  await openPanel(
    page,
    serializePlatformRoute({ module_id: 'analytics', scope: globalScope, state: { by: section } }),
  )
  const choices = page.locator('.analytics-panel [data-level-actions] [role="radiogroup"]')
  await expect(choices.first()).toBeVisible({ timeout: 10_000 })
  await page.evaluate(() => document.fonts.ready)
}

for (const locale of ['en', 'ru'] as const)
  for (const width of [390, 320])
    test(`in ${locale} at ${width}px, each choice of a heading row keeps to its row`, async ({
      page,
    }, info) => {
      test.setTimeout(120_000)
      await page.addInitScript((chosen) => localStorage.setItem('valkama-locale', chosen), locale)
      await page.setViewportSize({ width, height: 900 })
      await serve(page)
      await page.route('**/api/analytics/pauses?*', (route) =>
        route.fulfill({ json: pausesAnswer(PAUSES) }),
      )
      const seen: Record<string, Awaited<ReturnType<typeof measured>>> = {}
      for (const section of SECTIONS) {
        await open(page, section)
        // A wrapped row settles once its columns are measured: poll until it keeps to its row.
        await softly
          .poll(async () => everyInside(await measured(page)), {
            message: `${section}: every choice inside its row`,
            timeout: 10_000,
          })
          .toBe(true)
        const now = await measured(page)
        seen[section] = now
        expect.soft(now.choices.length, `${section}: a choice in a heading row`).toBeGreaterThan(0)
        for (const choice of now.choices) {
          expect.soft(choice.segments.length, `${section}: ${choice.label}`).toBeGreaterThan(1)
          expect
            .soft(choice.across, `${section}: ${choice.label} wrapped across its row`)
            .toBe(true)
          for (const segment of choice.segments) {
            expect.soft(segment.inside, `${section}: «${segment.text}» inside its row`).toBe(true)
            expect.soft(segment.whole, `${section}: «${segment.text}» whole`).toBe(true)
          }
        }
        expect.soft(now.sideways, `${section}: no sideways scroll (${now.scroll})`).toBe(false)
      }
      expect(Object.keys(seen)).toHaveLength(SECTIONS.length)
      await record(info, `head choices ${locale} ${width}`, seen)

      // The waits wrapped or not, the keyboard walks them with its ring on a segment in the row.
      await open(page, 'pauses')
      const waits = page.locator('.analytics-panel [data-level-actions] [role="radiogroup"]')
      await expect(waits).toHaveCount(1, { timeout: 10_000 })
      const segments = waits.getByRole('radio')
      await expect(segments).toHaveText([...WAITS[locale]], { timeout: 10_000 })
      await segments.first().focus({ timeout: 10_000 })
      const [first, ...rest] = WAITS[locale]
      await expect(waits.getByRole('radio', { name: first, exact: true })).toBeFocused({
        timeout: 10_000,
      })
      for (const words of rest) {
        await page.keyboard.press('ArrowRight')
        const segment = waits.getByRole('radio', { name: words, exact: true })
        await expect(segment).toBeFocused({ timeout: 10_000 })
        await expect(segment).toHaveAttribute('aria-checked', 'true', { timeout: 10_000 })
        const ring = await segment.evaluate((one) => {
          const row = one.closest('[data-level-head]')?.getBoundingClientRect() ?? new DOMRect()
          const box = one.getBoundingClientRect()
          return {
            visible: one.matches(':focus-visible') && getComputedStyle(one).outlineStyle !== 'none',
            inside: box.left >= row.left - 0.5 && box.right <= row.right + 0.5,
          }
        })
        expect.soft(ring, `«${words}»: its ring shown, inside the row`).toEqual({
          visible: true,
          inside: true,
        })
      }
    })

/** How many lines the segments of each choice in a heading row stand on. */
const choiceLines = (page: Page) =>
  page
    .locator('.analytics-panel [data-level-head] > [data-level-actions] [role="radiogroup"]')
    .evaluateAll((choices) =>
      choices
        .filter((choice) => choice.checkVisibility())
        .map(
          (choice) =>
            new Set(
              [...choice.querySelectorAll('[role="radio"]')].map((segment) =>
                Math.round(segment.getBoundingClientRect().top),
              ),
            ).size,
        ),
    )

/** Whether there are choices and each stands on one line. */
const oneLineEach = (lines: number[]) => lines.length > 0 && lines.every((count) => count === 1)

test('a choice wrapped on a phone stands on one line again once the window is wide', async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem('valkama-locale', 'ru'))
  await page.setViewportSize({ width: 320, height: 900 })
  await serve(page)
  await page.route('**/api/analytics/pauses?*', (route) =>
    route.fulfill({ json: pausesAnswer(PAUSES) }),
  )
  for (const section of ['pauses', 'token_kind']) {
    await page.setViewportSize({ width: 320, height: 900 })
    await open(page, section)
    // The present control: at 320px the widest choice of the section wraps.
    await expect
      .poll(async () => Math.max(...(await choiceLines(page))), {
        message: `${section} at 320px`,
        timeout: 10_000,
      })
      .toBeGreaterThan(1)
    // 1024px still shows one section at a time, so the same row is measured afresh.
    await page.setViewportSize({ width: 1024, height: 900 })
    await expect
      .poll(() => choiceLines(page).then(oneLineEach), {
        message: `${section} at 1024px: every choice on one line`,
        timeout: 10_000,
      })
      .toBe(true)
  }
})
