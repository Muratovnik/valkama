/**
 * Where the Analytics page's period chart opens when its periods take more room than the chart
 * has, in the real app over the browser double, in English and in Russian, at 390, 1024 and
 * 1440px, in both panels that draw it: the overview and a dimension's section.
 *
 * A live period, «Now» or «Today», opens on its running column: the minute or hour still running
 * stands whole inside the frame at the frame's end, clear of the scale, with the minutes that have
 * no data yet beside it, and the frame fades only toward an edge periods are hidden past — at the
 * scale, where the earlier minutes are, and at the end only over a later hour, never over the
 * running one or its name. A past period — this week, the past four weeks, an earlier
 * day — opens on its first periods, its first column beside the scale. Each lands on its own
 * opening when the reader switches from a past period to a live one and back, and a reload on
 * «Now» opens on the running minute again.
 *
 * While the reader leaves the frame where it opened, the running minute stays in view as the
 * minutes move on. Once they scroll it themselves, neither a new minute nor the bar's refresh
 * moves their place: the minute they read stays where it stood. Scrolled back to the running
 * minute, the frame follows it again. Each run prints what it measured.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { task } from '../fixtures/analytics.ts'
import type { TimedStretch } from '../fixtures/analytics.ts'
import { openReport, pageAt, record } from './analyticsPage.ts'
import { at, NOW, serveLive, settled, watchPage } from './liveDouble.ts'
import { test } from './test.ts'

const FIX = task(1, 'Fix the import')
const SHIP = task(2, 'Ship the release')

/** Work in the live hour, earlier today, yesterday and on days of the past four weeks. */
const WORK: TimedStretch[] = [
  { at: at(13, 40), group: { work_item: FIX }, spend: { seconds: 240 } },
  { at: at(14, 20), group: { work_item: SHIP }, spend: { seconds: 180 } },
  { at: at(9, 0), group: { work_item: FIX }, spend: { seconds: 3600 } },
  { at: new Date(2026, 10, 10, 11), group: { work_item: SHIP }, spend: { seconds: 5400 } },
  { at: new Date(2026, 10, 9, 10), group: { work_item: FIX }, spend: { seconds: 3600 } },
  { at: new Date(2026, 9, 20, 10), group: { work_item: SHIP }, spend: { seconds: 1800 } },
]

/** The newest record read: three minutes before the moment of the view, so three have no data. */
const LAST_EVENT = new Date(NOW.getTime() - 3 * 60_000)

const WIDTHS = [390, 1024, 1440]

/** How often «Now» reads itself again, in ms. */
const LIVE_INTERVAL = 30_000

const PANELS = [
  { key: 'overview', state: {} },
  { key: 'task', state: { by: 'work_item' } },
] as const

/** The words a reader chooses by, in each language the page speaks. */
const WORDS = {
  en: {
    now: 'Now',
    today: 'Today',
    week: 'This week',
    weeks4: 'Past 4 weeks',
  },
  ru: {
    now: 'Сейчас',
    today: 'Сегодня',
    week: 'Эта неделя',
    weeks4: '4 недели',
  },
} as const
type Locale = keyof typeof WORDS

/** How many columns each period stands as on Wednesday 11 November 2026 at 14:30. */
const COLUMNS = { now: 60, today: 24, week: 3, weeks4: 28, yesterday: 24 } as const

/**
 * Where the chart's frame stands: the room it shows periods in, from the scale's end to its own,
 * each period's slot, which one is running and which have no data yet, how far it is scrolled
 * and which edges it says periods are hidden past.
 */
const framePlace = (page: Page) =>
  page.evaluate(() => {
    const frame = document.querySelector<HTMLElement>('.spending-days .period-frame')
    if (!frame) throw new Error('no period frame')
    const { left, right } = frame.getBoundingClientRect()
    const gutter = Number.parseFloat(getComputedStyle(frame).getPropertyValue('--period-gutter'))
    const slots = [...frame.querySelectorAll<HTMLElement>('.period-slot')]
    const running = slots.findIndex((slot) => slot.querySelector('.period-incomplete'))
    // The running period's name on the time axis, by the key it shares with its column.
    const name = [...frame.querySelectorAll<HTMLElement>('.period-axis .chart-tick')]
      .find((tick) => tick.dataset.key === slots[running]?.dataset.key)
      ?.querySelector('span')
      ?.getBoundingClientRect()
    // How wide the fade toward a hidden edge is, as the frame resolves `--period-fade`.
    const ruler = document.createElement('div')
    ruler.style.inlineSize = 'var(--period-fade)'
    frame.append(ruler)
    const fade = ruler.getBoundingClientRect().width
    ruler.remove()
    return {
      room: { left: left + gutter, right },
      fade,
      scrolled: frame.scrollLeft,
      overflow: frame.scrollWidth - frame.clientWidth,
      slots: slots.map((slot) => {
        const box = slot.getBoundingClientRect()
        return { key: slot.dataset.key ?? '', left: box.left, right: box.right }
      }),
      running,
      name: name ? { left: name.left, right: name.right } : null,
      pending: slots.flatMap((slot, index) =>
        slot.querySelector('.period-pending') ? [index] : [],
      ),
      hint: {
        start: frame.dataset.hiddenStart !== undefined,
        end: frame.dataset.hiddenEnd !== undefined,
        drawn: getComputedStyle(frame).maskImage !== 'none',
      },
    }
  })
type Place = Awaited<ReturnType<typeof framePlace>>
type Slot = Place['slots'][number]

/** An opening: what is checked of the frame, and what each check must say. */
interface Opening {
  expected: Record<string, boolean>
  verdict: (place: Place) => Record<string, boolean>
}

/** Whether a slot stands whole between the scale's end and the frame's, to a pixel's rounding. */
const inView = (place: Place, slot: Slot | undefined) =>
  slot !== undefined && slot.left >= place.room.left - 1 && slot.right <= place.room.right + 1

/** The fade says what is hidden: at each edge exactly where periods lie past it, drawn if any. */
function fadeAgrees(place: Place) {
  const start = (place.slots[0]?.left ?? 0) < place.room.left - 1
  const end = (place.slots.at(-1)?.right ?? 0) > place.room.right + 1
  return place.hint.start === start && place.hint.end === end && place.hint.drawn === (start || end)
}

/**
 * Whether a box stands whole in the frame and clear of the fade toward its end, which is drawn
 * where periods are hidden past that end.
 */
function clearOfFade(place: Place, box: { left: number; right: number } | undefined) {
  const end = place.room.right - (place.hint.end ? place.fade : 0)
  return box !== undefined && box.left >= place.room.left - 1 && box.right <= end + 1
}

/**
 * Whether the running column stands at the frame's end, scrolled no further on than that takes:
 * the frame scrolled all the way where it is the last column; else the column after it whole in
 * view at the end, under the fade toward the later ones, and the one after that not.
 */
function atFrameEnd(place: Place) {
  const [next, beyond] = [place.slots[place.running + 1], place.slots[place.running + 2]]
  return next === undefined
    ? place.scrolled >= place.overflow - 1
    : inView(place, next) && !inView(place, beyond)
}

/**
 * What a live opening holds: the running column and its name on the time axis whole in view and
 * clear of the fade toward a hidden end, every column with no data yet beside it, at the frame's
 * end when the frame had to scroll to it, and the fade where periods are hidden — never at the
 * end of «Now», whose running minute is its last.
 */
function liveOpening(place: Place) {
  const running = place.slots[place.running]
  return {
    running: place.running >= 0 && inView(place, running),
    clearOfFade: clearOfFade(place, running) && clearOfFade(place, place.name ?? undefined),
    pending: place.pending.every((index) => inView(place, place.slots[index])),
    atEnd: place.scrolled <= 1 || atFrameEnd(place),
    fade: fadeAgrees(place),
  }
}
const LIVE: Opening = {
  verdict: liveOpening,
  expected: { running: true, clearOfFade: true, pending: true, atEnd: true, fade: true },
}

/** What a past opening holds: not scrolled, its first column beside the scale, the fade agreeing. */
function startOpening(place: Place) {
  return {
    start: place.scrolled <= 1,
    first: (place.slots[0]?.left ?? 0) >= place.room.left - 1,
    fade: fadeAgrees(place),
    noStartFade: !place.hint.start,
  }
}
const START: Opening = {
  verdict: startOpening,
  expected: { start: true, first: true, fade: true, noStartFade: true },
}

/** The section's control that draws its chart, in either language. */
const CHART = /^(?:Chart|График)$/u

/**
 * Shows the section's chart of `count` periods rather than its table, as a narrow page opens it:
 * chosen again where a new answer drew the section anew on its table.
 */
async function showChart(days: Locator, count: number) {
  await expect(async () => {
    if ((await days.getAttribute('data-shown')) !== 'chart')
      await days.getByRole('radio', { name: CHART }).click()
    await expect(days).toHaveAttribute('data-shown', 'chart', { timeout: 1000 })
    await expect(days.locator('.period-column')).toHaveCount(count, { timeout: 2000 })
  }).toPass()
}

/** Waits for the chart of `count` periods and returns where its frame opened. */
async function opened(page: Page, count: number, opening: Opening, label: string) {
  await showChart(page.locator('.spending-days'), count)
  await expect
    .poll(async () => opening.verdict(await framePlace(page)), { message: label })
    .toEqual(opening.expected)
  return framePlace(page)
}

const useLocale = (page: Page, locale: Locale) =>
  page.addInitScript((chosen) => localStorage.setItem('valkama-locale', chosen), locale)

for (const locale of ['en', 'ru'] as const)
  for (const width of WIDTHS)
    for (const panel of PANELS)
      test(`a live period opens on its running column, a past one on its first, in ${locale} at ${width}px in the ${panel.key} panel`, async ({
        page,
      }, info) => {
        const words = WORDS[locale]
        await useLocale(page, locale)
        const double = await serveLive(page, WORK)
        double.lastEventAt = LAST_EVENT
        const analytics = await openReport(page, width, pageAt({ ...panel.state, period: 'now' }))
        const period = analytics.locator('.analytics-period')
        const choose = async (name: string) => {
          await period.getByRole('radio', { name, exact: true }).click()
        }

        const measured: Record<string, unknown> = {}
        const keep = (name: string, place: Place) => {
          measured[name] = {
            scrolled: Math.round(place.scrolled),
            overflow: Math.round(place.overflow),
            running: place.running,
            hint: place.hint,
          }
        }

        keep('now', await opened(page, COLUMNS.now, LIVE, 'Now opened'))
        const now = await framePlace(page)
        // The minutes of «Now» never fit these charts: it opens scrolled, its end in view.
        expect(now.overflow, 'Now overflows its frame').toBeGreaterThan(0)
        expect(now.hint, 'the fade of Now').toEqual({ start: true, end: false, drawn: true })
        expect(now.pending, 'the minutes with no data yet').toHaveLength(3)

        await choose(words.week)
        keep('week', await opened(page, COLUMNS.week, START, 'Week opened'))
        await choose(words.now)
        keep('now again', await opened(page, COLUMNS.now, LIVE, 'Now from Week'))
        await choose(words.today)
        keep('today', await opened(page, COLUMNS.today, LIVE, 'Today from Now'))
        await choose(words.weeks4)
        keep('weeks4', await opened(page, COLUMNS.weeks4, START, '4 weeks opened'))
        await choose(words.today)
        keep('today again', await opened(page, COLUMNS.today, LIVE, 'Today again'))
        await choose(words.now)
        await opened(page, COLUMNS.now, LIVE, 'Now from Today')

        // A reload on «Now» opens on the running minute again.
        await page.reload()
        keep('reloaded', await opened(page, COLUMNS.now, LIVE, 'Now reloaded'))

        // An earlier day, by the hour as «Today» is, opens on its first hour, and «Today» on its own.
        const yesterday = { period: 'custom', from: '2026-11-10', to: '2026-11-10' }
        await openReport(page, width, pageAt({ ...panel.state, ...yesterday }))
        keep('yesterday', await opened(page, COLUMNS.yesterday, START, 'a past day'))
        await choose(words.today)
        await opened(page, COLUMNS.today, LIVE, 'Today from a past day')

        await record(info, `running column ${locale} ${width} ${panel.key}`, measured)
      })

/** The frame scrolled by the reader to `to` pixels, as a drag or a wheel would leave it. */
const scrollTo = (page: Page, to: 'end' | 'middle') =>
  page.locator('.spending-days .period-frame').evaluate((frame, where) => {
    const room = frame.scrollWidth - frame.clientWidth
    frame.scrollLeft = where === 'end' ? room : Math.round(room / 2)
  }, to)

/** The first period whole in the reader's view, which is where their place is. */
function readerPlace(place: Place) {
  const first = place.slots.find((slot) => slot.left >= place.room.left - 1)
  if (!first) throw new Error('no period in view')
  return first
}

/** The key of the period running. */
const runningKey = async (page: Page) => {
  const place = await framePlace(page)
  return place.slots[place.running]?.key
}

/** Whether the reader's period stands where it stood, the running one out of view. */
async function readerHeld(page: Page, reader: Slot) {
  const place = await framePlace(page)
  const slot = place.slots.find((one) => one.key === reader.key)
  return {
    kept: slot !== undefined && Math.abs(slot.left - reader.left) <= 1,
    runningHidden: !inView(place, place.slots[place.running]),
    fade: fadeAgrees(place),
  }
}
const HELD = { kept: true, runningHidden: true, fade: true }

/** Whether the frame says periods are hidden past its end. */
const hiddenAtEnd = async (page: Page) => {
  const place = await framePlace(page)
  return place.hint.end
}

for (const locale of ['en', 'ru'] as const)
  for (const width of WIDTHS)
    test(`«Now» follows its running minute until the reader scrolls, then holds their place, in ${locale} at ${width}px`, async ({
      page,
    }, info) => {
      await useLocale(page, locale)
      await page.clock.install({ time: NOW })
      const { count } = await watchPage(page)
      const double = await serveLive(page, WORK)
      double.lastEventAt = LAST_EVENT
      await page.clock.pauseAt(new Date(NOW.getTime() + 10_000))
      const analytics = await openReport(page, width, pageAt({ period: 'now' }))
      await settled(count, double)
      // The live period reads itself again each interval after its last read was answered: two
      // of them, each answered, move the view on a minute.
      const nextMinute = async () => {
        await page.clock.runFor(LIVE_INTERVAL)
        await settled(count, double)
        await page.clock.runFor(LIVE_INTERVAL)
        await settled(count, double)
      }
      const first = await opened(page, COLUMNS.now, LIVE, 'Now opened')

      // Left where it opened: a new minute is the running one, and it is in view.
      await nextMinute()
      await expect.poll(() => runningKey(page)).not.toBe(first.slots[first.running]?.key)
      const followed = await opened(page, COLUMNS.now, LIVE, 'a new minute followed')

      // Scrolled by the reader: a new minute keeps the minute they read where it stood.
      await scrollTo(page, 'middle')
      await expect.poll(() => hiddenAtEnd(page)).toBe(true)
      const place = readerPlace(await framePlace(page))
      await nextMinute()
      await expect.poll(() => runningKey(page)).not.toBe(followed.slots[followed.running]?.key)
      await expect
        .poll(() => readerHeld(page, place), { message: 'a new minute moved the reader' })
        .toEqual(HELD)

      // The bar's refresh reads the page again and moves nothing either.
      await analytics.locator('.analytics-refresh').click()
      await settled(count, double)
      await expect
        .poll(() => readerHeld(page, place), { message: 'the refresh moved the reader' })
        .toEqual(HELD)

      // Scrolled back to the running minute, the frame follows it again.
      await scrollTo(page, 'end')
      await expect.poll(async () => liveOpening(await framePlace(page))).toEqual(LIVE.expected)
      const before = await framePlace(page)
      await nextMinute()
      await expect.poll(() => runningKey(page)).not.toBe(before.slots[before.running]?.key)
      const again = await opened(page, COLUMNS.now, LIVE, 'followed again')

      await record(info, `running minute followed ${locale} ${width}`, {
        opened: Math.round(first.scrolled),
        followed: Math.round(followed.scrolled),
        reader: { key: place.key, left: Math.round(place.left) },
        again: Math.round(again.scrolled),
        overflow: Math.round(again.overflow),
      })
    })
