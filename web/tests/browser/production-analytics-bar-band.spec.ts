/**
 * The bar beside the reader's own span of days in the windows just wider than the two rows a
 * narrow bar always has, 1108 to 1440px beside the app's navigation, in either language, with and
 * without a refresh that failed. The oracle is the requirement: the bar is one line wherever that
 * line fits once it has given up all it can, a failure said included, and two rows, its last
 * give-up, wherever it does not. The line is fitted holding a failure's room, so it is one line or
 * two rows alike whether a refresh failed or not: about 1350px in English, 1390px in Russian.
 *
 * At every width the read again stands inside the bar, no text the bar draws is cut by a box or
 * drawn past the bar's end, and pressing the read again scrolls nothing sideways. A failure is said
 * in its whole words, on two rows on the second. The switch between the two is where the one line
 * stops fitting with the failure said: one window narrower than the narrowest one line, the bar is
 * two rows, and that line had less room to spare than the one pixel it loses there. A week at
 * 1280px, which fits, stays one line beside a failure.
 *
 * The browser reports no error on the way, a ResizeObserver loop included: the bar that changes
 * its number of rows on a resize changes its height while the browser measures sizes.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { pageAt, record } from './analyticsPage.ts'
import { NOW, serveLive } from './liveDouble.ts'
import { DAYS } from './served/analyticsBarBand.ts'
import { test } from './test.ts'
import { keepWindowErrors } from './windowErrors.ts'

/** The reader's own span of days. */
const OWN_DAYS = { period: 'custom', from: '2026-11-09', to: '2026-11-11' }

/** Windows from just over the narrow bar's 50rem to where the one line has room again. */
const BAND = [1108, 1200, 1280, 1320, 1360, 1400, 1440] as const

/** The failure's words, which the bar says with its retry, or without it on a line short of room. */
const FAILED = { en: 'Could not refresh', ru: 'Не удалось обновить' }

const frames = (page: Page) =>
  page.evaluate(
    () =>
      new Promise((done) =>
        requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(done))),
      ),
  )

/**
 * Every text the bar's line draws that is cut: drawn outside a box around it that hides what
 * overflows it, or past the line itself. Text hidden for assistive technology alone (`clip-path`)
 * is not drawn and not counted.
 */
const cutsOf = (page: Page) =>
  page.evaluate(() => {
    const bar = document.querySelector('.analytics-bar')
    const line = document.querySelector('.period-bar-line')
    if (!bar || !line) return [{ by: 'no bar', over: Number.NaN, text: '' }]
    const texts: Text[] = []
    const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode())
      if (node.textContent?.trim()) texts.push(node as Text)
    const around = (text: Text) => {
      const boxes: Element[] = []
      for (let up = text.parentElement; up && up !== bar; up = up.parentElement) boxes.push(up)
      return boxes
    }
    const shown = (text: Text) =>
      around(text).every((box) => {
        const style = getComputedStyle(box)
        return style.clipPath === 'none' && style.visibility !== 'hidden'
      })
    return texts
      .filter((text) => shown(text))
      .flatMap((text) => {
        const range = document.createRange()
        range.selectNodeContents(text)
        const drawn = range.getBoundingClientRect()
        const clips = around(text).filter((box) => getComputedStyle(box).overflowX !== 'visible')
        return [...clips, line]
          .map((edge) => {
            const { left, right } = edge.getBoundingClientRect()
            const over = Math.max(left - drawn.left, drawn.right - right)
            return { by: edge.className, over: Math.round(over * 10) / 10, text: text.data.trim() }
          })
          .filter((one) => drawn.width > 0 && one.over > 0.5)
      })
  })

/**
 * Where the bar's parts stand, whether it is two rows, the room its line spares, and every text
 * it draws that is cut (`cutsOf`).
 */
async function barOf(page: Page) {
  const parts = await page.evaluate(() => {
    const box = (selector: string) => {
      const found = document.querySelector(selector)?.getBoundingClientRect()
      return found
        ? { top: found.top, bottom: found.bottom, left: found.left, right: found.right }
        : null
    }
    const periods = box('.period-bar-periods')
    const refresh = box('.analytics-refresh')
    const words = document.querySelector('.refresh-failed-words')
    // The read again under the periods' row is on the second of two rows.
    let rows = 0
    if (periods && refresh) rows = (refresh.top + refresh.bottom) / 2 > periods.bottom ? 2 : 1
    return {
      line: box('.period-bar-line'),
      periods,
      refresh,
      own: box('.period-bar-own'),
      failure: box('.refresh-failed'),
      failureWords: words
        ? { hidden: words.classList.contains('visually-hidden'), ...box('.refresh-failed-words') }
        : null,
      rows,
      // The room the line leaves goes to the filter's field, past the least its words need.
      spare: (() => {
        const field = document.querySelector('.analytics-filter-add')
        if (!field) return Number.NaN
        const least = Number.parseFloat(getComputedStyle(field).minInlineSize)
        return Math.round((field.getBoundingClientRect().width - least) * 10) / 10
      })(),
    }
  })
  return { ...parts, cut: await cutsOf(page) }
}

type Bar = Awaited<ReturnType<typeof barOf>>

/** Every scroll the press of the read again could move: each box from it up to the page's. */
const scrolls = (page: Page) =>
  page.locator('.analytics-refresh').evaluate((button) => {
    const seen: number[] = []
    for (let up = button.parentElement; up; up = up.parentElement) seen.push(up.scrollLeft)
    return {
      seen,
      periods: document.querySelector('.period-bar-periods')?.getBoundingClientRect().left ?? 0,
    }
  })

/** The bar's line holds the read again and the periods, and cuts no text. */
function expectFits(name: string, bar: Bar) {
  const line = bar.line ?? { left: Number.NaN, right: Number.NaN }
  expect(bar.refresh?.right, `${name}: the read again past the bar`).toBeLessThanOrEqual(
    line.right + 0.5,
  )
  expect(bar.periods?.left, `${name}: the periods before the bar`).toBeGreaterThanOrEqual(
    line.left - 0.5,
  )
  expect(bar.cut, `${name}: text cut`).toEqual([])
  expect(bar.rows, `${name}: the bar's rows`).toBeGreaterThan(0)
}

/** A failure is said in its words, on one line or two rows; on two rows, on the second. */
function expectSaidWhole(name: string, bar: Bar) {
  expect(bar.failureWords?.hidden, `${name}: the failure said briefly`).toBe(false)
  const { left = 0, right = 0 } = bar.failureWords ?? {}
  expect(right - left, `${name}: the failure's words`).toBeGreaterThan(40)
  if (bar.rows !== 2) return
  expect(bar.failure?.top, `${name}: the failure under the periods`).toBeGreaterThanOrEqual(
    bar.periods?.bottom ?? Number.NaN,
  )
}

/**
 * The page over the double, the newest record 9 s old, every error reported to the window kept,
 * and every usage read refused while `fail` says so.
 */
async function serveBand(page: Page) {
  const errors = await keepWindowErrors(page)
  await page.clock.install({ time: NOW })
  const double = await serveLive(page, DAYS)
  double.lastEventAt = new Date(NOW.getTime() - 9000)
  let failing = false
  // Registered last, so it is asked first: while failing, every read is refused.
  await page.route('**/api/analytics/usage?*', (route) =>
    failing
      ? route.fulfill({ status: 500, contentType: 'application/json', body: '{}' })
      : route.fallback(),
  )
  return {
    fail: (now: boolean) => {
      failing = now
    },
    errors,
  }
}

/** Presses the read again and waits for what it says: the failure, when reads are refused. */
async function pressRefresh(page: Page, failure: string | null) {
  await page.locator('.analytics-refresh').click()
  if (failure) await expect(page.locator('.refresh-failed')).toContainText(failure)
  await frames(page)
}

/**
 * The narrowest window of one line, found by narrowing a pixel at a time from `from`, the
 * narrowest of the band that is one line, to `to`, the widest that is two rows; each width on the
 * way fits. One pixel narrower than it the bar is two rows, and its line had the room it spared.
 */
async function narrowToSwitch(page: Page, turn: ReturnType<typeof turnOf>) {
  let width = turn.from
  let last = turn.start
  for (; width > turn.to; width -= 1) {
    await page.setViewportSize({ width: width - 1, height: 900 })
    await frames(page)
    const bar = await barOf(page)
    expectFits(`${width - 1}px, narrowed`, bar)
    if (bar.rows === 2) break
    last = bar
  }
  return { spare: last?.spare ?? Number.NaN, width }
}

/** Where the band turns from two rows to one: the narrowest width of one line and the next. */
function turnOf(seen: Record<number, Bar>) {
  const rows = BAND.map((width) => seen[width]?.rows)
  const first = rows.indexOf(1)
  return {
    rows,
    from: BAND[first] ?? Number.NaN,
    start: seen[BAND[first] ?? 0] ?? null,
    to: BAND[first - 1] ?? Number.NaN,
    after: first === -1 ? [] : rows.slice(first),
  }
}

for (const lang of ['en', 'ru'] as const)
  test.describe(`the bar beside an own span of days, ${BAND[0]} to ${BAND.at(-1)}px, ${lang}`, () => {
    test.use({ locale: lang === 'ru' ? 'ru-RU' : 'en-US' })

    test('is one line where it fits and two rows where not, a refresh failed or not', async ({
      page,
    }, info) => {
      const band = await serveBand(page)
      const seen: Record<number, { failed: Bar; standing: Bar }> = {}
      for (const width of BAND) {
        const name = `${width}px`
        band.fail(false)
        await page.setViewportSize({ width, height: 900 })
        await page.goto(pageAt(OWN_DAYS))
        await expect(page.locator('.analytics-bar-fresh time')).toBeVisible()
        await page.evaluate(() => document.fonts.ready)
        await frames(page)
        const standing = await barOf(page)
        expectFits(`${name}, the reads standing`, standing)
        band.fail(true)
        await pressRefresh(page, FAILED[lang])
        const bar = await barOf(page)
        seen[width] = { standing, failed: bar }
        expectFits(name, bar)
        expectSaidWhole(name, bar)
        // The line is fitted holding the failure's room: as many rows whether it is said or not.
        expect(bar.rows, `${name}: the rows once the failure is said`).toBe(standing.rows)
        // The press of the read again scrolls nothing sideways.
        const before = await scrolls(page)
        await pressRefresh(page, FAILED[lang])
        expect(await scrolls(page), `${name}: scrolled by the press`).toEqual(before)
      }

      // Two rows at the band's start, where the one line does not fit; one line, once it fits,
      // stays one line in every wider window.
      const failedSeen = Object.fromEntries(
        Object.entries(seen).map(([width, bars]) => [width, bars.failed]),
      ) as Record<number, Bar>
      const turn = turnOf(failedSeen)
      expect(turn.rows[0], `the rows at ${BAND[0]}px`).toBe(2)
      expect(turn.after, 'the rows from the narrowest one line').not.toContain(2)
      expect(turn.after.length, 'one line somewhere in the band').toBeGreaterThan(0)

      // The switch, the failure said: one pixel narrower than the narrowest one line the bar is
      // two rows, and that line had under a pixel to spare.
      const switched = await narrowToSwitch(page, turn)
      await record(info, `bar-band ${lang}`, { switched, seen })
      expect(switched.spare, `${switched.width}px: room spared by one line`).toBeLessThan(1.5)
      expect(await band.errors(), 'errors reported to the window').toEqual([])
    })
  })

for (const lang of ['en', 'ru'] as const)
  test.describe(`a week beside a failed refresh, ${lang}`, () => {
    test.use({ locale: lang === 'ru' ? 'ru-RU' : 'en-US' })

    test('stays one line at 1280px', async ({ page }, info) => {
      const band = await serveBand(page)
      await page.setViewportSize({ width: 1280, height: 900 })
      await page.goto(pageAt())
      await expect(page.locator('.analytics-bar-fresh time')).toBeVisible()
      await page.evaluate(() => document.fonts.ready)
      band.fail(true)
      await pressRefresh(page, FAILED[lang])
      const bar = await barOf(page)
      await record(info, `bar-band week ${lang}`, bar)
      expectFits('a week at 1280px', bar)
      expect(bar.rows, 'a week at 1280px: the bar is one line').toBe(1)
      expect(await band.errors(), 'errors reported to the window').toEqual([])
    })
  })
