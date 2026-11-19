/**
 * The bar stays put: the freshness is one element, the live mark and the age, «● 5 s ago», with
 * the sentence and how often the period reads itself again in its hint, and the age counting up
 * from 5 s to 59 min moves and resizes nothing in the bar; a live period keeps the bar one row at
 * 1440px. An old record says its whole age there.
 * At 1440 and 1920 the bar keeps one height with none to four filters and with a span of days,
 * the filters it has no room for counted in «Filters: N»; the list of filters opens over the
 * panel, moving nothing, and a chip taken out leaves the focus in the bar. On a phone the bar is
 * three rows, its periods one row that scrolls sideways, with the rail right under it. «Today»,
 * chosen in the bar, is the day's hours 0 to 23 with the one running hatched, compared with the
 * same hours of yesterday, and its address gives the view back.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { openReport, pageAt, record, serve } from './analyticsPage.ts'
import { shot } from './boardPage.ts'
import { NOW, serveLive, settled, watchPage } from './liveDouble.ts'
import { DAYS, HOUR, TODAY } from './served/analyticsBar.ts'
import { test } from './test.ts'

const nowAddress = pageAt({ period: 'now' })

/** How far the middle of a box stands from the middle of another, down the page. */
const offCentre = (box: number[] | null | undefined, other: number[] | null | undefined) =>
  Math.abs((box?.[1] ?? 0) + (box?.[3] ?? 0) / 2 - (other?.[1] ?? 0) - (other?.[3] ?? 0) / 2)

/** Where the bar's parts stand and how big they are. */
const barParts = (page: Page) =>
  page.evaluate(() =>
    Object.fromEntries(
      [
        '.period-bar-periods',
        '.analytics-bar-filters',
        '.analytics-bar-fresh',
        '.analytics-refresh',
        '.analytics-bar',
      ].map((selector) => {
        const box = document.querySelector(selector)?.getBoundingClientRect()
        return [selector, box ? [box.x, box.y, box.width, box.height] : null]
      }),
    ),
  )

/**
 * What the freshness draws, its words hidden for assistive technology left out: the live mark,
 * then the age.
 */
const freshDrawn = (page: Page) =>
  page.evaluate(() => {
    const fresh = document.querySelector('.analytics-bar-fresh')
    const drawn: string[] = []
    const walker = document.createTreeWalker(fresh ?? document.body, NodeFilter.SHOW_ALL)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.parentElement?.closest('.visually-hidden')) continue
      if (node instanceof Element && node.matches('.analytics-bar-fresh-mark')) drawn.push('●')
      if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim())
        drawn.push(node.textContent.trim())
    }
    return drawn.join(' ')
  })

test('the age of the newest record counting up moves nothing in the bar, one row at 1440px', async ({
  page,
}, info) => {
  await page.clock.install({ time: NOW })
  const { count } = await watchPage(page)
  const double = await serveLive(page, HOUR)
  double.lastEventAt = new Date(NOW.getTime() - 1000)
  // The page's time stops before it opens, so the record is 5 s old however long opening takes:
  // paused after it, a slow open had already used up those seconds and the pause lay in the past.
  await page.clock.pauseAt(new Date(NOW.getTime() + 4000))
  const analytics = await openReport(page, 1440, nowAddress)
  await settled(count, double)
  const fresh = analytics.locator('.analytics-bar-fresh')
  const seen: Record<string, unknown> = {}
  const start = await barParts(page)
  // 5 s → 10 s, then 1 min → 2 min → 12 min → 59 min.
  for (const [step, words] of [
    [0, '● 5\u{A0}s ago'],
    [5000, '● 10\u{A0}s ago'],
    [50_000, '● 1\u{A0}min ago'],
    [60_000, '● 2\u{A0}min ago'],
    [600_000, '● 12\u{A0}min ago'],
    [2_820_000, '● 59\u{A0}min ago'],
  ] as const) {
    // The page's time jumps on, as a lid closed and opened again does, each due timer fired once:
    // run through, every live read of 47 minutes took the test past its time beside other specs.
    await page.clock.fastForward(step)
    // One element: the live mark and the age, the sentence whole in its hint.
    await expect.poll(() => freshDrawn(page)).toBe(words)
    await expect(fresh).toHaveAttribute(
      'data-tooltip',
      new RegExp(`^Newest record \\d\\d:\\d\\d · ${words.slice(2)}\\nLive, every 30\\u{A0}s$`, 'u'),
    )
    const now = await barParts(page)
    seen[words] = now
    expect(now, `the bar at «${words}»`).toEqual(start)
  }
  // One row: the periods, the filters, the freshness and the read again stand on one line.
  const [period, ...rest] = [
    '.period-bar-periods',
    '.analytics-bar-filters',
    '.analytics-bar-fresh',
    '.analytics-refresh',
  ].map((selector) => start[selector])
  for (const part of rest) expect(offCentre(part, period)).toBeLessThan(4)
  await record(info, 'bar-steady', seen)
})

test('on a phone the bar is three rows, its periods one row, and the rail right under it', async ({
  page,
}, info) => {
  await serve(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(pageAt())
  await expect(page.locator('.analytics-rail-entry').first()).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  const measured = await page.evaluate(() => {
    const bar = document.querySelector('.analytics-bar')?.getBoundingClientRect()
    const rail = document.querySelector('.analytics-rail')?.getBoundingClientRect()
    const options = [...document.querySelectorAll('.period-bar-periods .segmented-option')].map(
      (option) => option.getBoundingClientRect().y,
    )
    return { bar: bar?.height ?? 0, gap: (rail?.y ?? 0) - (bar?.bottom ?? 0), options }
  })
  await record(info, 'bar-phone', measured)
  expect(measured.options).toHaveLength(5)
  expect(new Set(measured.options).size, 'the periods in one row').toBe(1)
  expect(measured.gap).toBeGreaterThanOrEqual(0)
  expect(measured.gap).toBeLessThan(40)
  await expect(page.getByRole('button', { name: 'Refresh' })).toBeVisible()

  // Three rows of one height whatever period is chosen (DESIGN.md): the periods, the filter with
  // the read again, and the room of the reader's own days, which a span of days fills without
  // moving anything.
  await page.goto(pageAt({ period: 'custom', from: '2026-11-09', to: '2026-11-11' }))
  await expect(page.locator('.analytics-bar input[type="date"]')).toHaveCount(2)
  const own = await page.evaluate(() => {
    const box = (selector: string) => {
      const found = document.querySelector(selector)?.getBoundingClientRect()
      return found ? { top: found.top, bottom: found.bottom } : null
    }
    return {
      bar: document.querySelector('.analytics-bar')?.getBoundingClientRect().height ?? 0,
      rows: [
        box('.period-bar-periods'),
        box('.analytics-refresh'),
        box('.analytics-bar input[type="date"]'),
      ],
    }
  })
  await record(info, 'bar-phone-own', own)
  expect(own.bar, 'the bar beside a span of days').toBe(measured.bar)
  for (const [index, row] of own.rows.slice(1).entries())
    expect(
      row?.top ?? Number.NaN,
      `row ${index + 2} under row ${index + 1}`,
    ).toBeGreaterThanOrEqual((own.rows[index]?.bottom ?? Number.NaN) - 0.5)
  await page.goto(pageAt())
  await expect(page.locator('.analytics-rail-entry').first()).toBeVisible()

  // The freshness shows its age alone, whole, inside the bar; the sentence with the clock time is
  // its hint, and what a screen reader hears.
  const fresh = page.locator('.analytics-bar-fresh')
  const shown = await fresh.evaluate((element) => {
    const box = element.getBoundingClientRect()
    const bar = document.querySelector('.analytics-bar')?.getBoundingClientRect()
    return {
      inside: box.left >= (bar?.left ?? 0) - 0.5 && box.right <= (bar?.right ?? 0) + 0.5,
      words: element.textContent ?? '',
    }
  })
  const drawn = await freshDrawn(page)
  await record(info, 'bar-phone-fresh', { ...shown, drawn })
  const [, age] = /^Newest record \d\d:\d\d · (.+)$/u.exec(shown.words.trim()) ?? []
  expect(age).toBeTruthy()
  // The age, or its span alone where the line gave up the word around it: «just now», «5 s».
  expect(drawn).toMatch(/^(just now|\d+\s(s|min|h)(\s\d+\s(min|h))?(\sago)?)$/u)
  expect(shown.inside, 'the age is outside the bar').toBe(true)
  await fresh.hover()
  // The sentence up to its age, which may have counted on a second since it was read.
  const [said] = shown.words.trim().split(' · ')
  await expect(page.getByRole('tooltip')).toContainText(`${said} · `)
})

/** The hour columns of the overview's chart: each one's start, and whether it is hatched. */
const hours = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('.spending-days .period-slot')].map((slot) => ({
      key: (slot as HTMLElement).dataset.key ?? '',
      hatched: slot.querySelector('.period-incomplete') !== null,
    })),
  )

test('«Today» is its hours 0 to 23, the running one hatched, against the same hours of yesterday', async ({
  page,
}, info) => {
  await page.clock.install({ time: NOW })
  const double = await serveLive(page, TODAY)
  await openReport(page, 1440, pageAt())
  const periods = page.locator('.period-bar-periods')
  await expect(periods.getByRole('radio')).toHaveText([
    'Now',
    'Today',
    'This week',
    'Past 4 weeks',
    'Custom',
  ])
  await periods.getByRole('radio', { name: 'Today' }).click()
  await expect
    .poll(() => page.url().slice(new URL(page.url()).origin.length))
    .toBe(pageAt({ period: 'today' }))
  await expect(page.locator('.spending-days .period-slot')).toHaveCount(24)

  const shown = await hours(page)
  const starts = shown.map(({ key }) => new Date(key).getHours())
  expect(starts).toEqual(Array.from({ length: 24 }, (_, hour) => hour))
  expect(shown.filter(({ hatched }) => hatched).map(({ key }) => new Date(key).getHours())).toEqual(
    [14],
  )

  // Asked by the hour for the whole day, and beside it yesterday from its midnight to now's time.
  const day = double.asked.filter((query) => query.get('from') === '2026-11-11')
  expect(day.at(-1)?.get('to')).toBe('2026-11-12')
  expect(day.at(-1)?.get('step')).toBe('hour')
  const yesterday = double.asked.filter(
    (query) => query.get('from') === new Date(2026, 10, 10).toISOString(),
  )
  expect(yesterday.length).toBeGreaterThan(0)
  for (const query of yesterday) {
    expect(Date.parse(query.get('to') ?? '')).toBeLessThan(new Date(2026, 10, 10, 14, 31).getTime())
    expect(Date.parse(query.get('to') ?? '')).toBeGreaterThanOrEqual(
      new Date(2026, 10, 10, 14, 30).getTime(),
    )
  }
  // Forty minutes today against fifteen yesterday by now; yesterday's evening is not counted.
  await expect(page.locator('.tile-figure[data-measure="time"]')).toHaveText('40 min')
  const change = page.locator('.spending-tiles .tile-change').first()
  await expect(change).toContainText('↑ 167%')
  // Yesterday's hours are named by their day, which the clock times alone would leave as today's.
  await expect(change).toContainText(/Nov\s10,\s00:00\s– 14:30/u)
  const against = await change.textContent()

  await page.locator('.spending-days').screenshot(shot(info, 'analytics-today-1440.png'))

  // The address gives the view back.
  await page.reload()
  await expect(periods.getByRole('radio', { name: 'Today' })).toBeChecked()
  await expect(page.locator('.spending-days .period-slot')).toHaveCount(24)
  await record(info, 'analytics today', {
    hatched: shown.filter(({ hatched }) => hatched).length,
    columns: shown.length,
    against,
    yesterday: yesterday.map((query) => [query.get('from'), query.get('to')]),
  })
})

/** A newest record hours old: 6 h 44 min before now. */
const OLD = new Date(NOW.getTime() - (6 * 60 + 44) * 60_000)

/** Filters of none to four values, each a chip. */
const CHIPS: Record<string, string[]>[] = [
  {},
  { model: ['model-a'] },
  { model: ['model-a', 'model-b'] },
  { project: ['alpha'], model: ['model-a', 'model-b'] },
  { project: ['alpha', 'beta'], model: ['model-a', 'model-b'] },
]
const CUSTOM = { period: 'custom', from: '2026-11-09', to: '2026-11-11' }

/** How many filters a set holds, and its address beside a period's. */
const countOf = (filters: Record<string, string[]>) => Object.values(filters).flat().length
const addressOf = (filters: Record<string, string[]>, period: Record<string, string> = {}) =>
  countOf(filters) ? { ...period, filters: JSON.stringify(filters) } : period

/** What the bar says of its filters: none when each is a chip, else all of them counted. */
const FOLDED = { en: 'Filters', ru: 'Фильтры' }
const foldedWords = (lang: 'en' | 'ru', chips: number, count: number) =>
  chips < count ? `${FOLDED[lang]}: ${count}` : null

/** How many of three short filters stand as chips at least: all three at 1920px. */
const LEAST_OF_THREE: Record<number, number> = { 1440: 0, 1920: 3 }

/** Takes a chip out by its button: a press, or Enter on the button focused. */
async function takeOut(page: Page, key: 'click' | 'Enter', name: string) {
  const button = page.getByRole('button', { name })
  if (key === 'click') {
    await button.click()
    return
  }
  await button.focus()
  await page.keyboard.press('Enter')
}

/** Opens the page at an address and waits for its answer and the bar's words to settle. */
async function openBar(page: Page, state: Record<string, string>) {
  await page.goto(pageAt(state))
  await expect(page.locator('.analytics-bar-fresh time')).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  // The chips the bar has room for are counted once their names and the bar's room are known.
  await page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  )
}

/** The bar's height, where the panel under it starts, and what the bar shows of its filters. */
const barState = (page: Page) =>
  page.evaluate(() => {
    const bar = document.querySelector('.analytics-bar')?.getBoundingClientRect()
    const panel = document.querySelector('.analytics-panel')?.getBoundingClientRect()
    const room = document.querySelector('.analytics-bar-filters')?.getBoundingClientRect()
    const chips = [...document.querySelectorAll('.analytics-bar-filters .combo-chip')].map((chip) =>
      chip.getBoundingClientRect(),
    )
    return {
      bar: Math.round(bar?.height ?? 0),
      panel: Math.round(panel?.y ?? 0),
      chips: chips.length,
      // Every chip shown stands whole inside the filters' room, none cut at its edge.
      whole: chips.every((chip) => chip.right <= (room?.right ?? 0) + 0.5),
      folded: document.querySelector('.analytics-filter-folded')?.textContent?.trim(),
    }
  })

for (const lang of ['en', 'ru'] as const)
  test.describe(`the bar, ${lang}`, () => {
    test.use({ locale: lang === 'ru' ? 'ru-RU' : 'en-US' })

    test('an old record says its whole age at 1440px, with filters or none', async ({
      page,
    }, info) => {
      const double = await serveLive(page, DAYS)
      double.lastEventAt = OLD
      await page.setViewportSize({ width: 1440, height: 900 })
      for (const filters of [CHIPS[0] ?? {}, CHIPS[1] ?? {}, CHIPS[3] ?? {}]) {
        const count = countOf(filters)
        await openBar(page, addressOf(filters))
        const time = page.locator('.analytics-bar-fresh time')
        const shown = await time.evaluate((element) => ({
          words: element.textContent?.trim() ?? '',
          cut: element.scrollWidth > element.clientWidth,
        }))
        await record(info, `bar-old-record ${lang} ${count}`, shown)
        expect(shown.words).toMatch(
          lang === 'ru'
            ? /^Последняя запись \d\d:\d\d · 6\sч\s44\sмин\sназад$/u
            : /^Newest record \d\d:\d\d · 6\sh\s44\smin\sago$/u,
        )
        expect(shown.cut, `the age is cut with ${count} filters`).toBe(false)
      }
    })

    for (const width of [1440, 1920])
      test(`the bar keeps its height with any filters and a span of days at ${width}px`, async ({
        page,
      }, info) => {
        const double = await serveLive(page, DAYS)
        double.lastEventAt = OLD
        await page.setViewportSize({ width, height: 900 })
        const seen: Record<string, Awaited<ReturnType<typeof barState>>> = {}
        for (const period of [{} as Record<string, string>, CUSTOM])
          for (const filters of CHIPS) {
            const count = countOf(filters)
            await openBar(page, addressOf(filters, period))
            const now = await barState(page)
            const name = `${period.period ?? 'week'} ${count}`
            seen[name] = now
            expect(now.whole, `a chip cut, ${name}`).toBe(true)
            // Each filter is a chip, or counted with the rest in «Filters: N».
            expect(now.folded ?? null, name).toBe(foldedWords(lang, now.chips, count))
          }
        await record(info, `bar-height ${lang} ${width}`, seen)
        const first = seen['week 0']
        for (const [name, state] of Object.entries(seen)) {
          expect(state.bar, `the bar's height, ${name}`).toBe(first?.bar)
          expect(state.panel, `the panel's top, ${name}`).toBe(first?.panel)
        }
        // At 1920 three filters stand as chips beside the period.
        expect(seen['week 3']?.chips).toBeGreaterThanOrEqual(LEAST_OF_THREE[width] ?? 0)
      })
  })

test('the list of filters opens over the panel and moves nothing', async ({ page }, info) => {
  await serveLive(page, DAYS)
  await page.setViewportSize({ width: 1440, height: 900 })
  await openBar(page, { filters: JSON.stringify({ model: ['model-a'] }) })
  const panel = page.locator('.analytics-panel')
  const before = await panel.boundingBox()
  const add = page.locator('.analytics-filter-add')
  await add.click()
  const list = page.locator('.analytics-filter-body')
  await expect(list).toBeVisible()
  await expect(list.locator('[data-dimension]')).toHaveCount(10)
  const after = await panel.boundingBox()
  const over = await list.boundingBox()
  await record(info, 'bar-filter-list', { before, after, over })
  expect(after).toEqual(before)
  // Over the panel, and what is drawn there is the list, not the panel through it.
  const bottom = (over?.y ?? 0) + (over?.height ?? 0)
  expect(bottom).toBeGreaterThan((before?.y ?? 0) + 40)
  const onTop = await page.evaluate(
    ({ x, y }) => document.elementFromPoint(x, y)?.closest('.analytics-filter-body') != null,
    { x: (over?.x ?? 0) + 24, y: bottom - 8 },
  )
  expect(onTop, 'the list is under the panel').toBe(true)
  // A value chosen in a field leaves the list open; Escape closes it and gives the focus back.
  await list.locator('[data-dimension="project"] input').click()
  await page.getByRole('option', { name: 'alpha' }).click()
  await expect(
    page.locator('.analytics-bar-filters .combo-chip', { hasText: 'alpha' }),
  ).toHaveCount(1)
  await expect(list).toBeVisible()
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await expect(list).toBeHidden()
  await expect(add).toBeFocused()
  // A press outside closes it too, and leaves the focus where it was pressed.
  await add.click()
  await expect(list).toBeVisible()
  await page.locator('.analytics-bar-fresh').click()
  await expect(list).toBeHidden()
})

for (const key of ['click', 'Enter'] as const)
  test(`a chip taken out by ${key} leaves the focus in the bar`, async ({ page }, info) => {
    await serveLive(page, DAYS)
    await page.setViewportSize({ width: 1440, height: 900 })
    await openBar(page, { filters: JSON.stringify({ model: ['model-a', 'model-b'] }) })
    const focused = () =>
      page.evaluate(() => ({
        inBar: document.activeElement?.closest('.analytics-bar') != null,
        tag: document.activeElement?.tagName,
        name:
          document.activeElement?.getAttribute('aria-label') ??
          document.activeElement?.textContent?.trim(),
      }))
    // The first chip out: the focus moves to the chip that took its place.
    await takeOut(page, key, 'Remove Model: model-a')
    await expect(page.locator('.analytics-bar-filters .combo-chip')).toHaveCount(1)
    const neighbour = await focused()
    // The last chip out: the focus moves to «Add a filter».
    await takeOut(page, key, 'Remove Model: model-b')
    await expect(page.locator('.analytics-bar-filters .combo-chip')).toHaveCount(0)
    const last = await focused()
    await record(info, `bar-chip-focus ${key}`, { neighbour, last })
    expect(neighbour).toEqual({ inBar: true, tag: 'BUTTON', name: 'Remove Model: model-b' })
    expect(last).toEqual({ inBar: true, tag: 'BUTTON', name: 'Add a filter' })
  })
