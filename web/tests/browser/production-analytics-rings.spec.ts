/**
 * The sections whose values split one whole open on a ring, in the real app over the browser
 * double: agent time by effort and by environment while the section is not split, and the tokens
 * by kind. The oracle is the requirement: the ring is drawn with a legend naming its parts
 * in its order, five sectors at most with the smaller past them folded into one rest; a sector
 * pointed at or reached with the keyboard shows one hint with its figure and share; the section's
 * «Table» shows every value as before; split by a second dimension, the section draws its pairs as
 * ranked bars again; a sector of a value pressed opens the value's side panel over the view; a
 * sector reached from the keyboard shows its focus ring, in the forced palette's highlight there,
 * and a pointer press shows none. At 1440 and 360 pixels the ring stands inside its column and its
 * legend clear of it, and no words stand on a sector. At 1440 and 1024 pixels, in English and in
 * Russian, the legend of the tokens by kind names every kind whole, the two cache writes told apart,
 * and says each kind's share once after its figure. Each run prints what it measured and keeps a
 * picture of each section.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { value } from '../fixtures/analytics.ts'
import type { TimedStretch } from '../fixtures/analytics.ts'
import { openPanel, pageAt, record, serve } from './analyticsPage.ts'
import { shot } from './boardPage.ts'
import { sectorBand } from './ringBand.ts'
import { test } from './test.ts'

/** A stretch of agent work on a day of the week so far, at an effort, in an environment. */
const stretch = (day: number, effort: string | null, environment: string, hours: number) => ({
  at: new Date(2026, 10, day, 10),
  group: {
    model: value(day % 2 ? 'model-a' : 'model-b'),
    environment: value(environment),
    ...(effort ? { effort: value(effort) } : {}),
  },
  spend: { seconds: hours * 3600, tokens: hours * 1_000_000, cost: hours * 2 },
})

/**
 * The week so far, 12 h 45 min: high 6 h, medium 3 h, low 1 h 30 min, xhigh 1 h, work with no
 * effort, which the page calls unknown, 45 min and max 30 min, so the two smallest fold into the
 * rest; 9 h local and the rest in
 * the cloud.
 */
const WEEK: TimedStretch[] = [
  stretch(9, 'high', 'local', 4),
  stretch(10, 'high', 'cloud', 2),
  stretch(9, 'medium', 'local', 3),
  stretch(10, 'low', 'cloud', 1.5),
  stretch(11, 'xhigh', 'local', 1),
  stretch(11, null, 'local', 0.75),
  stretch(11, 'max', 'local', 0.25),
  stretch(10, 'max', 'cloud', 0.25),
]

const ring = (page: Page) => page.locator('.analytics-panel .donut-chart').first()

/** Opens a section at a width and waits for its ring, shown as the chart rather than the table. */
async function openRing(
  page: Page,
  state: Record<string, string>,
  width: number,
  { stretches = WEEK, ringName = 'Ring' }: { ringName?: string; stretches?: TimedStretch[] } = {},
) {
  await serve(page, stretches)
  await page.setViewportSize({ width, height: 900 })
  // A phone opens on the rail: its chosen section is a press away.
  await openPanel(page, pageAt(state))
  // The ring, where the section opens on its bars, is a press away.
  const section = page.locator('.analytics-panel .chart-section').first()
  await expect(section).toBeVisible()
  const chart = section.getByRole('radio', { name: ringName, exact: true })
  if (!(await chart.isChecked())) await chart.click()
  await expect(ring(page).locator('.donut-sector').first()).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  return section
}

/**
 * Where the ring, its legend and its column stand: whether the ring and the legend stand inside
 * the column and clear of each other, and whether any words stand on the ring.
 */
function layout(section: Locator) {
  return section.evaluate((column) => {
    // This body is serialized and evaluated in the page, so a module-scope
    // helper would not be in scope here.
    // eslint-disable-next-line unicorn/consistent-function-scoping -- see above
    const box = (element: Element | null) => {
      const { left, right, top, bottom } = element?.getBoundingClientRect() ?? new DOMRect()
      return { left, right, top, bottom }
    }
    const inside = (inner: ReturnType<typeof box>, outer: ReturnType<typeof box>) =>
      inner.left >= outer.left - 0.5 &&
      inner.right <= outer.right + 0.5 &&
      inner.top >= outer.top - 0.5 &&
      inner.bottom <= outer.bottom + 0.5
    const meet = (one: ReturnType<typeof box>, other: ReturnType<typeof box>) =>
      one.left < other.right &&
      other.left < one.right &&
      one.top < other.bottom &&
      other.top < one.bottom
    const own = box(column)
    const ringBox = box(column.querySelector('.donut-ring'))
    const legend = box(column.querySelector('.chart-legend'))
    const entries = [...column.querySelectorAll('[data-hint-list="legend"] li')].map((one) =>
      box(one),
    )
    return {
      ringSize: Math.round(ringBox.right - ringBox.left),
      ringInColumn: inside(ringBox, own),
      legendInColumn: inside(legend, own),
      legendClearOfRing: !meet(legend, ringBox),
      wordsOnRing: column.querySelector('.donut-ring')?.textContent ?? '',
      entriesApart: entries.every((one, at) =>
        entries.slice(at + 1).every((other) => !meet(one, other)),
      ),
    }
  })
}

/** The middle of the band of the ring's largest sector, where its hint stands. */
const largestBand = (chart: Locator) => sectorBand(chart.locator('.donut-sector').first())

const SOUND = {
  ringInColumn: true,
  legendInColumn: true,
  legendClearOfRing: true,
  wordsOnRing: '',
  entriesApart: true,
}

test('agent time by effort is a ring of five sectors at most, with a legend, a hint a sector and its table', async ({
  page,
}, info) => {
  const section = await openRing(page, { by: 'effort' }, 1440)
  const chart = ring(page)
  await expect(section.locator('h3')).toHaveText('Agent time by effort')
  await expect(section.locator('.ranked-bars')).toHaveCount(0)

  // Four efforts by name and the two smallest, no effort and max, folded into one rest.
  const names = ['high', 'medium', 'low', 'xhigh', 'Other, 2 more']
  await expect(
    chart.locator('[data-hint-list="legend"] [data-series] [data-part="name"]'),
  ).toHaveText(names)
  await expect(chart.locator('.donut-sector')).toHaveCount(5)
  await expect(chart.locator('.donut-sector').last()).toHaveAttribute('data-slot', 'other')

  // Pointed at, the largest says its figure and share in one hint, drawn as a grid.
  const hint = page.locator('.tooltip-hint')
  const largest = chart.locator('.donut-sector').first()
  const band = await largestBand(chart)
  await page.mouse.move(band.x, band.y)
  await expect(hint).toBeVisible()
  await expect(hint).toContainText('high')
  await expect(hint).toContainText('6 h')
  await expect(hint).toContainText('47% of the total')
  // It stands at the top right of the middle of the sector's band,
  // as a chart's hint stands at its point: its bottom left corner 6px past it and over it.
  await expect(async () => {
    const placed = await hint.boundingBox()
    if (!placed) throw new Error('no hint')
    expect(Math.abs(placed.x - (band.x + 6)), 'across').toBeLessThan(1)
    expect(Math.abs(band.y - 6 - (placed.y + placed.height)), 'down').toBeLessThan(1)
  }).toPass({ timeout: 3000 })
  await page.mouse.move(0, 0)
  await expect(hint).toBeHidden()

  // From the keyboard: one stop, the arrows walk round, the hint follows the focus.
  await largest.focus()
  await page.keyboard.press('ArrowLeft')
  await expect(chart.locator('.donut-sector').last()).toBeFocused()
  await expect(hint).toBeVisible()
  await expect(hint).toContainText('Other, 2 more')
  await expect(hint).toContainText('Unknown')
  await expect(hint).toContainText('max')

  const measured = await layout(section)
  await record(info, 'ring effort 1440', measured)
  expect(measured).toMatchObject(SOUND)
  await section.screenshot(shot(info, 'ring-effort-1440.png'))

  // Its table lists every effort, the two the ring folds among them, as it did.
  await section.getByRole('radio', { name: 'Table', exact: true }).click()
  await expect(section.locator('.donut-chart')).toHaveCount(0)
  await expect(section.locator('tbody th')).toHaveText([
    'high',
    'medium',
    'low',
    'xhigh',
    'Unknown',
    'max',
  ])
})

test('split by a second dimension, the effort section draws its pairs as ranked bars again', async ({
  page,
}) => {
  await serve(page, WEEK)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(pageAt({ by: 'effort', across: 'model' }))
  const section = page.locator('.analytics-panel .chart-section').first()
  await expect(section.locator('.ranked-bars .ranked-label').first()).toContainText('·')
  await expect(section.locator('.donut-chart')).toHaveCount(0)
})

test('agent time by environment is a ring whose sector opens its value’s side panel', async ({
  page,
}, info) => {
  const section = await openRing(page, { by: 'environment' }, 1440)
  const chart = ring(page)
  await expect(section.locator('h3')).toHaveText('Agent time by environment')
  await expect(
    chart.locator('[data-hint-list="legend"] [data-series] [data-part="name"]'),
  ).toHaveText(['local', 'cloud'])
  await record(info, 'ring environment 1440', await layout(section))

  const address = page.url()
  const local = chart.locator('.donut-drawing').getByRole('button', { name: /local/u })
  await expect(local).toHaveCount(1)
  // Pressed in its band: the middle of its box is the ring's hole.
  const band = await largestBand(chart)
  await page.mouse.click(band.x, band.y)
  await expect.poll(() => page.url()).not.toBe(address)
  // The address's state, read back, keeps the view and opens the environment pressed in the panel.
  const state = () => {
    const encoded = new URL(page.url()).searchParams.get('state') ?? ''
    return JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')) as Record<string, string>
  }
  await expect.poll(() => state().detail).toBe('{"by":"environment","value":"local"}')
  expect(state()).toEqual({ by: 'environment', detail: '{"by":"environment","value":"local"}' })
  await expect(page.getByRole('dialog', { name: 'Details: local' })).toBeVisible()
})

for (const width of [1440, 360])
  test(`at ${width} pixels the rings stand inside their column with no words on them`, async ({
    page,
  }, info) => {
    const effort = await openRing(page, { by: 'effort' }, width)
    const seen: Record<string, unknown> = { effort: await layout(effort) }
    expect(seen.effort).toMatchObject(SOUND)
    await effort.screenshot(shot(info, `ring-effort-${width}.png`))

    const kinds = await openRing(page, { by: 'token_kind' }, width)
    seen.kinds = await layout(kinds)
    await record(info, `rings ${width}`, seen)
    expect(seen.kinds).toMatchObject(SOUND)
    await expect(kinds.locator('.donut-note-name')).toHaveText(['Cache read', 'Reasoning'])
    await kinds.screenshot(shot(info, `ring-kinds-${width}.png`))
  })

/**
 * A week of tokens of every kind, the two cache writes among them: what the tokens figure counts
 * is 150 M — cache writes for 5 minutes 90 M, output 30 M, cache writes for an hour 24 M and
 * input 6 M — and the cache reads and the reasoning stand apart.
 */
const KINDS: TimedStretch[] = [
  {
    at: new Date(2026, 10, 9, 10),
    group: { model: value('model-a') },
    spend: {
      seconds: 3600,
      cost: 20,
      kinds: {
        input: 6_000_000,
        cached_read: 2_000_000_000,
        cache_write_5m: 90_000_000,
        cache_write_1h: 24_000_000,
        output: 30_000_000,
        reasoning: 10_000_000,
      },
    },
  },
]

/** The kinds the legend names, largest first, in each language the page speaks. */
const KIND_NAMES = {
  en: ['Cache write, 5 min', 'Output', 'Cache write, 1 h', 'Input'],
  ru: ['Запись в кэш, 5 мин', 'Выход', 'Запись в кэш, 1 ч', 'Вход'],
}
/** The view the section draws its ring in, by the name of its choice. */
const RING_VIEW = { en: 'Ring', ru: 'Кольцо' }

for (const locale of ['en', 'ru'] as const)
  for (const width of [1440, 1024])
    test(`at ${width} pixels in ${locale} the legend of the tokens by kind names every kind whole and its share once`, async ({
      page,
    }, info) => {
      await page.addInitScript((chosen) => localStorage.setItem('valkama-locale', chosen), locale)
      const kinds = await openRing(page, { by: 'token_kind' }, width, {
        stretches: KINDS,
        ringName: RING_VIEW[locale],
      })
      const legend = ring(page).locator('[data-hint-list="legend"]')
      const entries = legend.getByRole('listitem')
      const names = legend.locator('[data-series] [data-part="name"]')
      await expect(entries).toHaveCount(4)
      await expect(names).toHaveText(KIND_NAMES[locale])
      const seen = await entries.evaluateAll((all) =>
        all.map((entry) => {
          const name = entry.querySelector<HTMLElement>('[data-part="name"]')
          const figure = entry.querySelector<HTMLElement>('[data-part="figure"]')
          const list = entry.closest('[data-hint-list]')?.getBoundingClientRect()
          return {
            name: name?.textContent ?? '',
            cut: name ? name.scrollWidth - name.clientWidth : Number.NaN,
            figure: figure?.textContent ?? '',
            figurePast: figure && list ? figure.getBoundingClientRect().right - list.right : 0,
            shares: (entry.textContent?.match(/%/gu) ?? []).length,
          }
        }),
      )
      await record(info, `ring kinds legend ${locale} ${width}`, seen)
      for (const one of seen) {
        expect.soft(one.cut, `«${one.name}» cut at ${width}px`).toBeLessThanOrEqual(0)
        expect.soft(one.figurePast, `«${one.figure}» past the legend`).toBeLessThanOrEqual(0.5)
        expect.soft(one.shares, `«${one.figure}»: one share`).toBe(1)
      }
      await kinds.screenshot(shot(info, `ring-kinds-legend-${locale}-${width}.png`))
    })

/**
 * Moves focus onto the ring's second sector from the keyboard, then presses the largest in its
 * band at three o'clock with the pointer: what each sector shows and the colour of its ring.
 */
async function focusThenPress(page: Page) {
  const sectors = ring(page).locator('.donut-sector')
  await sectors.first().focus()
  await page.keyboard.press('ArrowRight')
  const keyed = await sectors.nth(1).evaluate((sector) => ({
    stroke: getComputedStyle(sector).stroke,
    shown: sector.matches(':focus-visible'),
  }))
  const band = await ring(page).locator('.donut-ring').boundingBox()
  if (!band) throw new Error('the ring is not laid out')
  // Read while held down: the release narrows the view and redraws the ring.
  await page.mouse.move(band.x + band.width * 0.905, band.y + band.height / 2)
  await page.mouse.down()
  const pressed = await sectors.first().evaluate((sector) => ({
    focused: sector === document.activeElement,
    shown: sector.matches(':focus-visible'),
  }))
  await page.mouse.up()
  return { keyed, pressed }
}

test('a sector reached from the keyboard shows its ring, in the forced palette too, and a pointer press none', async ({
  page,
}) => {
  await openRing(page, { by: 'effort' }, 1440)
  const themed = await focusThenPress(page)
  expect(themed.keyed.shown).toBe(true)
  expect(themed.pressed).toEqual({ focused: true, shown: false })

  await page.emulateMedia({ forcedColors: 'active' })
  await openRing(page, { by: 'effort' }, 1440)
  const forced = await focusThenPress(page)
  expect(forced.keyed.shown).toBe(true)
  // The forced palette's highlight, not the theme's ring the series fill would otherwise keep.
  expect(forced.keyed.stroke).not.toBe(themed.keyed.stroke)
  expect(forced.keyed.stroke).toBe(
    await page.evaluate(() => {
      const probe = document.createElement('i')
      probe.style.color = 'Highlight'
      document.body.append(probe)
      const color = getComputedStyle(probe).color
      probe.remove()
      return color
    }),
  )
  expect(forced.pressed).toEqual({ focused: true, shown: false })
})
