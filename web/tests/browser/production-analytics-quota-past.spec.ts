/**
 * How a quota window's previous window ended, and that window shown in the card, in the built app.
 *
 * Under each window stands one quiet line: «Previous window: until Nov 7, 14:30 — 9%» where the
 * window before it is kept, with that it ran out where it did, and «Previous window: no readings»
 * where none is. Here «Work» alone has windows before its five hours and its week; every other
 * window of the fixture has none. The line stays one line inside its window, in English and in
 * Russian, at 1440 pixels and at 1024.
 *
 * The line with a window is a button. It shows that window in the card in place of the current
 * one — whose share, bar, facts and readings stand hidden meanwhile — on an axis from the window's
 * start to its reset, with its readings; «Earlier» steps back to the window before while one is
 * kept, and «Current window» returns. The past windows are answered here by the read's rule: the
 * latest window of the kind that reset at or before the moment asked by.
 */
import { expect } from '@playwright/test'
import type { Page, TestInfo } from '@playwright/test'

import type { Quota, QuotaEndedWindow, QuotaShareWindow } from '@/shared/api/analyticsApi.ts'

import { momentAt } from '../fixtures/analytics.ts'
import { quotaAt, share } from '../fixtures/quota.ts'
import { present } from '../support/present.ts'
import { NOW, openPanel, pageAt, record, serve, serveQuota, shortfalls } from './analyticsPage.ts'
import { test } from './test.ts'

const HOUR = 3_600_000
const DAY = 24 * HOUR
const now = NOW.getTime()
const offset = -NOW.getTimezoneOffset()
const at = (ms: number) => momentAt(ms, offset)

/** A window past its reset, `left` ms after now (so before it), as the window read answers it. */
function ended(
  kind: 'five_hour' | 'week',
  left: number,
  readings: [ago: number, percent: number][],
  previous: QuotaEndedWindow | null = null,
): QuotaShareWindow {
  const window = share(now, offset, {
    kind,
    left,
    readings,
    source: 'poll',
    forecast: null,
    previous,
  })
  return { ...window, even_percent: null }
}

/** How a window ended, as the window after it says. */
function endOf(window: QuotaShareWindow, ranOut: boolean): QuotaEndedWindow {
  return {
    started_at: present(window.started_at, 'a past window’s start'),
    resets_at: present(window.resets_at, 'a past window’s reset'),
    latest: window.latest,
    ran_out: ranOut,
  }
}

// «Work»'s week started 4 days before now, on 7 November at 14:30; the week before it ran from
// 31 October, and the one before that from 24 October, with one reading.
const OLDEST_WEEK = ended('week', -11 * DAY, [[12 * DAY, 55]])
const LAST_WEEK = ended(
  'week',
  -4 * DAY,
  [
    [10 * DAY, 3],
    [7 * DAY, 6],
    [4 * DAY + 4 * HOUR, 9],
  ],
  endOf(OLDEST_WEEK, false),
)
// Its five hours started at 11:30 today, after a night with no work; the five hours before them
// ran from 17:30 yesterday to 22:30 and ran out at 22:15, so their line is the longest a line
// says: a dated reset, a whole share and that it ran out.
const LAST_FIVE_HOURS = ended('five_hour', -16 * HOUR, [
  [20 * HOUR, 40],
  [18 * HOUR, 80],
  [16.25 * HOUR, 100],
])
const PAST = [LAST_WEEK, OLDEST_WEEK, LAST_FIVE_HOURS]

/** The quota fixture with «Work»'s five hours and week each saying how the window before ended. */
function withPrevious(): Quota {
  const quota = quotaAt(NOW)
  const work = present(quota.accounts[0], '«Work»')
  for (const window of work.windows) {
    if (!('readings' in window)) continue
    if (window.kind === 'week') window.previous = endOf(LAST_WEEK, false)
    if (window.kind === 'five_hour') window.previous = endOf(LAST_FIVE_HOURS, true)
  }
  return quota
}

/**
 * Answers the window read by its rule: the latest kept window of the kind asked that reset at or
 * before `before`, or none. A failing answer is given while `failing` says so. Returns what was
 * asked, each a query. Called once the page is served, so it stands over the app's double, which
 * answers a read it has no fixture for with an empty body.
 */
async function servePast(page: Page, failing = { first: false }) {
  const asked: URLSearchParams[] = []
  await page.route('**/api/analytics/quota/window?*', async (route) => {
    const query = new URL(route.request().url()).searchParams
    asked.push(query)
    if (failing.first) {
      failing.first = false
      await route.fulfill({ status: 500, contentType: 'application/json', body: '{}' })
      return
    }
    const before = Date.parse(query.get('before') ?? '')
    const window =
      PAST.filter(
        (one) => one.kind === query.get('kind') && Date.parse(one.resets_at ?? '') <= before,
      ).sort(
        (one, other) => Date.parse(other.resets_at ?? '') - Date.parse(one.resets_at ?? ''),
      )[0] ?? null
    await route.fulfill({
      json: {
        interface_version: 'valkama-analytics-api',
        quota_window: {
          now: at(now),
          utc_offset: offset,
          fresh_for_seconds: 900,
          retained_from: at(now - 365 * DAY),
          account: query.get('account'),
          kind: query.get('kind'),
          model: null,
          before: query.get('before'),
          window,
        },
      },
    })
  })
  return asked
}

async function open(page: Page, by: 'quota_five_hour' | 'quota_week', width = 1440) {
  await serve(page)
  await serveQuota(page, withPrevious())
  await page.setViewportSize({ width, height: 1000 })
  await openPanel(page, pageAt({ by }))
  return page.locator('.quota-panel')
}

const LINES = '[data-past="line"], [data-past="none"]'

/**
 * Each shown line under a window: its words, how many rows its text runs on, and how far its right
 * edge passes its window's, in pixels.
 */
const lineRows = (page: Page) =>
  page.evaluate(
    (selector) =>
      [...document.querySelectorAll<HTMLElement>(selector)]
        .filter((line) => line.checkVisibility())
        .map((line) => {
          const tops = new Set<number>()
          const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT)
          for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            if (!node.textContent?.trim()) continue
            const range = document.createRange()
            range.selectNodeContents(node)
            for (const rect of range.getClientRects()) tops.add(Math.round(rect.top))
          }
          const card = line.closest('[data-window]')?.getBoundingClientRect()
          return {
            text: line.textContent.trim(),
            rows: tops.size,
            past: card
              ? Math.round((line.getBoundingClientRect().right - card.right) * 100) / 100
              : null,
          }
        }),
    LINES,
  )

/** Every shown line is one row, cut by nothing, inside its window. */
async function expectWhole(page: Page, info: TestInfo, name: string, count: number) {
  await expect(page.locator(`:is(${LINES}):visible`)).toHaveCount(count)
  const rows = await lineRows(page)
  const short = await shortfalls(page, LINES)
  await record(info, name, { rows, short })
  expect(rows).toHaveLength(count)
  for (const line of rows) {
    expect(line.rows, line.text).toBe(1)
    expect(line.past, line.text).not.toBeNull()
    expect(line.past ?? 1, line.text).toBeLessThanOrEqual(0.5)
  }
  expect(short).toHaveLength(count)
  for (const line of short) expect(line.short, line.text).toBeLessThanOrEqual(0)
}

/** The kinds of window each quota section shows. */
const KINDS = { quota_five_hour: ['five_hour'], quota_week: ['week', 'week_model'] }

/** The line «Work»'s week shows, in each language. */
const WEEK_LINE = {
  en: /^Previous window: until Nov 7, 14:30 — 9%$/u,
  ru: /^Прошлое окно: до 7 нояб\., 14:30 — 9\s?%$/u,
}

/** How many readings «Work»'s current week holds in the fixture. */
function workWeekReadings() {
  const week = withPrevious().accounts[0]?.windows.find((one) => one.kind === 'week')
  return week && 'readings' in week ? week.readings.length : 0
}

/** How many share windows of these kinds the fixture gives, and how many say no window before. */
function counted(kinds: string[]) {
  const windows = withPrevious()
    .accounts.flatMap((account) => account.windows)
    .filter(
      (window): window is QuotaShareWindow => 'readings' in window && kinds.includes(window.kind),
    )
  return { all: windows.length, none: windows.filter((window) => !window.previous).length }
}

test('the line under a window names how the window before it ended, or that none was read', async ({
  page,
}) => {
  const panel = await open(page, 'quota_five_hour')
  const work = panel.locator('[data-account="Work"] [data-window="five_hour"]')
  await expect(work.locator('[data-past="line"]')).toHaveText(
    'Previous window: until Nov 10, 22:30 — 100%, ran out',
  )
  const { all, none } = counted(['five_hour'])
  expect(none).toBeGreaterThan(0)
  await expect(panel.locator('[data-past="line"]')).toHaveCount(all - none)
  const quiet = panel.locator('[data-past="none"]')
  await expect(quiet).toHaveCount(none)
  for (const one of await quiet.all()) await expect(one).toHaveText('Previous window: no readings')
  // The line that has no window is words, not a control.
  await expect(panel.getByRole('button', { name: 'Previous window: no readings' })).toHaveCount(0)

  await page.goto(pageAt({ by: 'quota_week' }))
  await expect(
    panel.locator('[data-account="Work"] [data-window="week"] [data-past="line"]'),
  ).toHaveText('Previous window: until Nov 7, 14:30 — 9%')
})

for (const lang of ['en', 'ru'] as const) {
  test.describe(`in ${lang === 'ru' ? 'Russian' : 'English'}`, () => {
    test.use({ locale: lang === 'ru' ? 'ru-RU' : 'en-US' })

    for (const width of [1440, 1024]) {
      test(`each line stays one whole row in its window at ${width} pixels`, async ({
        page,
      }, info) => {
        for (const by of ['quota_five_hour', 'quota_week'] as const) {
          await open(page, by, width)
          const { all } = counted(KINDS[by])
          await expectWhole(page, info, `quota-past-${lang}-${width}-${by}`, all)
        }
        await expect(
          page.locator('[data-account="Work"] [data-window="week"] [data-past="line"]'),
        ).toHaveText(WEEK_LINE[lang])
      })
    }
  })
}

test('the line shows the past window on its own axis, steps back, and returns', async ({
  page,
}) => {
  const panel = await open(page, 'quota_week')
  const asked = await servePast(page)
  await panel.getByRole('radio', { name: 'Chart' }).check()
  const card = panel.locator('[data-account="Work"] [data-window="week"]')
  const facts = card.locator('[data-fact]')
  await expect(facts.first()).toBeVisible()
  const chart = card.locator('[data-chart="steps"]:visible')
  await expect(chart).toHaveCount(1)

  await card.locator('[data-past="line"]').click()
  // The view is named by the window it shows, so it is found by its hook once that name changes.
  const view = card.locator('[data-past="view"]')
  await expect(
    card.getByRole('region', { name: 'Week, past window: Oct 31, 14:30 – Nov 7, 14:30' }),
  ).toBeVisible()
  await expect(view.locator('[data-past="shown"]')).toHaveText(
    'Past window: Oct 31, 14:30 – Nov 7, 14:30',
  )
  await expect(view.locator('[data-past="lead"]')).toHaveText('9% by the reset')
  expect(asked).toHaveLength(1)
  const [first] = asked
  expect(first?.get('kind')).toBe('week')
  expect(first?.get('account')).toBe(withPrevious().accounts[0]?.account)
  expect(Date.parse(first?.get('before') ?? '')).toBe(now - 4 * DAY)

  // The current window's facts, bar and readings stand hidden; the one chart shown is the past
  // window's, from its start to its reset, which its axis names as passed, with its three readings.
  await expect(facts).not.toHaveCount(0)
  for (const fact of await facts.all()) await expect(fact).toBeHidden()
  await expect(card.locator('.window-bar:visible')).toHaveCount(0)
  await expect(chart).toHaveCount(1)
  await expect(view.locator('[data-region="axis"] [data-moment]')).toHaveText([
    'start Oct 31, 14:30',
    'reset at Nov 7, 14:30',
  ])
  await expect(view.locator('[data-reading]')).toHaveCount(3)

  // «Earlier» names the window before, and shows it; nothing is kept before that one.
  await view.getByRole('button', { name: 'Earlier window: until Oct 31, 14:30 — 55%' }).click()
  await expect(view.locator('[data-past="shown"]')).toHaveText(
    'Past window: Oct 24, 14:30 – Oct 31, 14:30',
  )
  await expect(
    card.getByRole('region', { name: 'Week, past window: Oct 24, 14:30 – Oct 31, 14:30' }),
  ).toBeVisible()
  await expect(view.locator('[data-region="axis"] [data-moment]')).toHaveText([
    'start Oct 24, 14:30',
    'reset at Oct 31, 14:30',
  ])
  await expect(view.locator('[data-reading]')).toHaveCount(1)
  await expect(view.locator('[data-past="no-earlier"]')).toHaveText('No readings earlier')
  await expect(view.locator('[data-past="earlier"]')).toHaveCount(0)
  expect(Date.parse(asked[1]?.get('before') ?? '')).toBe(now - 11 * DAY)

  // «Current window» returns: the line again, and the window's own facts and readings.
  await view.getByRole('button', { name: 'Current window' }).click()
  await expect(card.locator('[data-past="view"]')).toHaveCount(0)
  await expect(card.locator('[data-past="line"]')).toBeVisible()
  for (const fact of await facts.all()) await expect(fact).toBeVisible()
  await expect(chart).toHaveCount(1)
  const readings = workWeekReadings()
  expect(readings).toBeGreaterThan(0)
  await expect(chart.locator('[data-reading]')).toHaveCount(readings)

  // As a table, the past window is its readings' table. The chart and the table are two views of
  // the panel, so the window is opened again there.
  await panel.getByRole('radio', { name: 'Table' }).check()
  await card.locator('[data-past="line"]').click()
  const table = card.getByRole('region', {
    name: 'Week, past window: Oct 31, 14:30 – Nov 7, 14:30',
  })
  await expect(table.locator('tbody tr[data-key]')).toHaveCount(3)
  await expect(table.locator('[data-chart="steps"]')).toHaveCount(0)
})

test('a window that ran out says so, and the keyboard opens, steps and returns', async ({
  page,
}) => {
  const panel = await open(page, 'quota_five_hour')
  await servePast(page)
  await panel.getByRole('radio', { name: 'Chart' }).check()
  const card = panel.locator('[data-account="Work"] [data-window="five_hour"]')
  const line = card.getByRole('button', {
    name: 'Previous window: until Nov 10, 22:30 — 100%, ran out',
  })
  await line.focus()
  await page.keyboard.press('Enter')
  const view = card.getByRole('region', {
    name: 'Five hours, past window: Nov 10, 17:30 – Nov 10, 22:30',
  })
  await expect(view).toBeVisible()
  await expect(view.locator('[data-past="lead"]')).toHaveText(
    '100% by the reset · the limit ran out before it',
  )
  await expect(view.locator('[data-reading]')).toHaveCount(3)
  // Nothing is kept before it, so the focus waits on the way back.
  await expect(view.locator('[data-past="no-earlier"]')).toBeVisible()
  const back = view.getByRole('button', { name: 'Current window' })
  await expect(back).toBeFocused()
  await page.keyboard.press('Space')
  await expect(card.locator('[data-past="view"]')).toHaveCount(0)
  await expect(line).toBeFocused()
})

test('the keyboard steps back through the weeks with «Earlier»', async ({ page }) => {
  const panel = await open(page, 'quota_week')
  await servePast(page)
  const card = panel.locator('[data-account="Work"] [data-window="week"]')
  const line = card.locator('[data-past="line"]')
  await line.focus()
  await page.keyboard.press('Enter')
  const view = card.locator('[data-past="view"]')
  await expect(view.locator('[data-past="shown"]')).toHaveText(
    'Past window: Oct 31, 14:30 – Nov 7, 14:30',
  )
  await expect(view.getByRole('button', { name: 'Current window' })).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  const earlier = view.locator('[data-past="earlier"]')
  await expect(earlier).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(view.locator('[data-past="shown"]')).toHaveText(
    'Past window: Oct 24, 14:30 – Oct 31, 14:30',
  )
  await expect(view).toHaveAttribute(
    'aria-label',
    'Week, past window: Oct 24, 14:30 – Oct 31, 14:30',
  )
  // With nothing earlier, the focus moves to the way back rather than to nothing.
  await expect(view.getByRole('button', { name: 'Current window' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(line).toBeFocused()
})

test('a read that fails says so and is asked again, the current window still hidden', async ({
  page,
}) => {
  const panel = await open(page, 'quota_week')
  const asked = await servePast(page, { first: true })
  const card = panel.locator('[data-account="Work"] [data-window="week"]')
  await card.locator('[data-past="line"]').click()
  const view = card.locator('[data-past="view"]')
  const failure = view.getByRole('alert')
  await expect(failure).toContainText('The past window could not be loaded.')
  await expect(card.locator('[data-fact]:visible')).toHaveCount(0)
  await failure.getByRole('button', { name: 'Retry' }).click()
  await expect(view.locator('[data-past="shown"]')).toHaveText(
    'Past window: Oct 31, 14:30 – Nov 7, 14:30',
  )
  await expect(view.getByRole('alert')).toHaveCount(0)
  expect(asked).toHaveLength(2)
  expect(asked[1]?.get('before')).toBe(asked[0]?.get('before'))
})
