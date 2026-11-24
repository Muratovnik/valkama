/**
 * The Analytics bar's chip while the name of the value it holds is read, on phones of 320 to 430px,
 * in Russian and in English, from a past period and from a live one (DESIGN.md, the Analytics bar:
 * «a filter set has its dimension's read to name its chip»).
 *
 * Before the first answer the chip says its dimension and never the value's id: it said «Задача:
 * 00000000-0…». Once named, a chip keeps its name while its dimension is read again for another
 * period, rather than its id until the new answer, and so the bar keeps its height through that
 * read: the id took the widest chip's room and put «Снять фильтры» on a second line, 32px, at 380
 * to 401px in Russian. A refresh that fails leaves the name as it was.
 *
 * How tall the bar stands before the first answer and after it is measured and recorded, not held:
 * a name the answer brings may be wider or narrower than the room the chip held for it.
 */
import { expect } from '@playwright/test'
import type { Page, Route } from '@playwright/test'

import { task } from '../fixtures/analytics.ts'
import { failRefresh, frames, serveFailing } from './analyticsBarFailure.ts'
import { pageAt, record } from './analyticsPage.ts'
import { test } from './test.ts'

const WIDTHS = [320, 340, 360, 370, 380, 384, 390, 399, 400, 401, 410, 430] as const

/** The task the filter holds, as the double names it (`served/analyticsBarStates.ts`). */
const FILTERED = task(1, 'One').id ?? ''
const FILTER = JSON.stringify({ work_item: [FILTERED] })
/** What the chip says of it once named, in either language. */
const NAMED = /MAIN-1 One/u
/** The start of the task's id, which the chip never says. */
const ID = FILTERED.slice(0, 8)

const WORDS = {
  ru: { dimension: 'Задача', today: 'Сегодня', week: 'Эта неделя' },
  en: { dimension: 'Task', today: 'Today', week: 'This week' },
} as const

/** A past period and a live one, each with the one it switches to. */
const PERIODS = {
  week: { state: {}, next: 'today' },
  today: { state: { period: 'today' }, next: 'week' },
} as const

test.use({ locale: 'ru-RU', launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] } })

/**
 * Holds the usage reads `which` takes while `holding`, each until `release`; the double answers
 * the rest. Registered after the double's own routes, so it is asked first.
 */
async function holdReads(page: Page) {
  let which: ((query: URLSearchParams) => boolean) | null = null
  const held: Route[] = []
  await page.route('**/api/analytics/usage?*', async (route) => {
    const query = new URL(route.request().url()).searchParams
    if (which?.(query)) held.push(route)
    else await route.fallback()
  })
  return {
    held,
    hold: (reads: (query: URLSearchParams) => boolean) => {
      which = reads
    },
    async release() {
      which = null
      for (const route of held.splice(0)) await route.fallback()
    },
  }
}

/** A read of what the task filter offers: by task, and not itself filtered by one. */
const offering = (query: URLSearchParams) =>
  (query.get('group_by') ?? '').split(',').includes('work_item') && !query.has('work_item')

/** The bar's height and what each chip says. */
const chipState = (page: Page) =>
  page.evaluate(() => ({
    bar: document.querySelector('.analytics-bar')?.getBoundingClientRect().height ?? 0,
    chips: [...document.querySelectorAll('.analytics-bar [data-filter-chip]')].map(
      (chip) => chip.textContent?.trim() ?? '',
    ),
  }))

type ChipState = Awaited<ReturnType<typeof chipState>>

/** The state at each width, the page settled after each resize. */
async function acrossWidths(page: Page) {
  const seen: Record<number, ChipState> = {}
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 })
    await page.evaluate(() => document.fonts.ready)
    await frames(page)
    seen[width] = await chipState(page)
  }
  return seen
}

/** One chip, saying the dimension, and never the task's id. */
function expectNoId(name: string, seen: Record<number, ChipState>, dimension: string) {
  for (const [width, state] of Object.entries(seen)) {
    expect.soft(state.chips, `${name} at ${width}px: the chips`).toHaveLength(1)
    expect.soft(state.chips[0], `${name} at ${width}px: the chip's dimension`).toContain(dimension)
    expect.soft(state.chips[0], `${name} at ${width}px: the task's id`).not.toContain(ID)
  }
}

for (const locale of ['ru', 'en'] as const)
  for (const [from, period] of Object.entries(PERIODS))
    test(`a chip says no id while its name is read, from ${from} in ${locale}`, async ({
      page,
    }, info) => {
      const words = WORDS[locale]
      await page.addInitScript((chosen) => localStorage.setItem('valkama-locale', chosen), locale)
      const fail = await serveFailing(page, WIDTHS[0])
      const reads = await holdReads(page)
      const chip = page.locator('.analytics-bar [data-filter-chip]')

      // Before the first answer: every read held.
      reads.hold(() => true)
      await page.goto(pageAt({ ...period.state, filters: FILTER }))
      await expect(chip).toHaveCount(1)
      await expect.poll(() => reads.held.length).toBeGreaterThan(0)
      const first = await acrossWidths(page)
      expectNoId('before the first answer', first, words.dimension)

      // Named by the answer.
      await reads.release()
      await expect(chip).toHaveText(NAMED)
      const named = await acrossWidths(page)

      // Another period: the chip's dimension read again, held.
      reads.hold(offering)
      await page.getByRole('radio', { name: words[period.next] }).click()
      await expect.poll(() => reads.held.length).toBeGreaterThan(0)
      const switching = await acrossWidths(page)
      await reads.release()
      await expect(page.locator('.analytics-bar-fresh time')).toBeVisible()
      await expect.poll(() => reads.held.length).toBe(0)
      const settled = await acrossWidths(page)

      // A refresh that fails leaves the name.
      fail(true)
      await failRefresh(page)
      const failed = await acrossWidths(page)

      await record(info, `bar chips read ${locale} ${from}`, {
        first,
        named,
        switching,
        settled,
        failed,
      })
      expectNoId('read again for another period', switching, words.dimension)
      for (const width of WIDTHS) {
        const was = named[width]?.chips
        expect
          .soft(switching[width]?.chips, `switching at ${width}px: the chip's name`)
          .toEqual(was)
        expect.soft(settled[width]?.chips, `settled at ${width}px: the chip's name`).toEqual(was)
        expect.soft(failed[width]?.chips, `failed at ${width}px: the chip's name`).toEqual(was)
        expect
          .soft(switching[width]?.bar, `switching at ${width}px: the bar's height`)
          .toBe(settled[width]?.bar)
        expect
          .soft(failed[width]?.bar, `failed at ${width}px: the bar's height`)
          .toBe(settled[width]?.bar)
      }
    })
