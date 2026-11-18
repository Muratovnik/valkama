/**
 * How the quota draws a window's forecast in the real app, at the widths it is used at — 1440,
 * 1024 and 390 pixels — in English and in Russian, drawn as charts. The oracle is the rule of the
 * hatch: a figure not final yet is hatched and named, a final one never is.
 *
 * Every window's share spent is solid, a silent one's too, which says in words how long it has
 * been silent. Its forecast is a hatched tail inside the track, from the share spent: a week's
 * range in two parts, parted where its slower pace ends; five hours that last to the share their
 * answer says they spend by the reset; five hours that run out to the track's end; none for a
 * window too new for a forecast, for one spent or read past 100 %; and from the track's start at
 * 0 %. The
 * forecast's line leads with the hatch's key, «Forecast ·», with a swatch where a tail is drawn;
 * the swatch hangs in the card's start gutter, so the line's words start where the reset's do.
 * Each step line past its readings points at «now» and, where a forecast has a share to draw to,
 * runs its corridor to the reset and points at its end: the corridor inside the plot, each
 * place's hint at its mark and clear of the line's head, nothing moving while pointed at; the
 * latest reading keeps its own dot, however close to «now» it was read. A window past its reset
 * draws neither. Each run attaches what it measured.
 *
 * Every part is read by the hook its component documents (`QuotaAccount`, `QuotaWindow`,
 * `WindowBar`, `StepLine`), and every set is held to the size its case gives before anything is
 * said of each of its members.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { messages } from '@/shared/i18n/index.ts'

import { quotaAt, quotaOfEdges } from '../fixtures/quota.ts'
import { NOW, openPanel, pageAt, record, serve, serveQuota } from './analyticsPage.ts'
import { drawLined } from './drawnViews.ts'
import { swatchLines } from './quotaSwatch.ts'
import { aheadOfLines, cornersOutside, hintAtDot, latestHint } from './stepAhead.ts'
import type { LineAhead } from './stepAhead.ts'
import { test } from './test.ts'

const HOUR = 3_600_000

/** Every quota window's step line. */
const LINES = '[data-window] [data-chart="steps"]'

/**
 * What each window draws, by account and window: its fill and its tail's parts, to the half percent
 * of the track, each part from where its run starts — where the fill or the part before ends.
 */
interface Drawn {
  /** Whether the step line runs a corridor, and the places past its readings it points at. */
  corridor: boolean
  /** Where the fill ends, or null for none. */
  fill: number | null
  places: string[]
  /** Whether the forecast's line leads with the hatch's swatch. */
  swatch: boolean
  tail: [number, number][]
}

const FIVE_HOURS: Record<string, Drawn> = {
  'Work five_hour': {
    fill: 62,
    tail: [[62, 100]],
    swatch: true,
    corridor: true,
    places: ['now', 'reset'],
  },
  // A fresh 0 % that lasts to the reset: the tail from the track's start to the 35 % its answer
  // says it spends by then (DESIGN.md, `WindowBar`).
  '7e6d5c4b five_hour': {
    fill: null,
    tail: [[0, 35]],
    swatch: true,
    corridor: true,
    places: ['now', 'reset'],
  },
  'a1b2c3d4 five_hour': {
    fill: 74,
    tail: [[74, 100]],
    swatch: true,
    corridor: true,
    places: ['now', 'reset'],
  },
  // Spent: nothing past the fill, and the corridor flat along the top to the reset.
  'Edge five_hour': {
    fill: 100,
    tail: [],
    swatch: false,
    corridor: true,
    places: ['now', 'reset'],
  },
}

const WEEKS: Record<string, Drawn> = {
  'Work week': {
    fill: 41,
    tail: [
      [41, 57],
      [57, 61],
    ],
    swatch: true,
    corridor: true,
    places: ['now', 'reset'],
  },
  'Work week_model': { fill: 12.5, tail: [], swatch: false, corridor: false, places: ['now'] },
  // Silent, its share as solid as a fresh one's, and a range that may run out, cut at the end.
  '7e6d5c4b week': {
    fill: 88,
    tail: [
      [88, 97.5],
      [97.5, 100],
    ],
    swatch: true,
    corridor: true,
    places: ['now', 'reset'],
  },
  'a1b2c3d4 week': { fill: 20, tail: [], swatch: false, corridor: false, places: ['now'] },
  // Read past 100 %: the fill stops at the track's end and nothing is ahead of it.
  'Edge week': { fill: 100, tail: [], swatch: false, corridor: true, places: ['now', 'reset'] },
  // A fresh 0 %: no fill, the tail from the track's start.
  'Edge week_model': {
    fill: null,
    tail: [
      [0, 4],
      [4, 9],
    ],
    swatch: true,
    corridor: true,
    places: ['now', 'reset'],
  },
}

/**
 * Each drawn window: its account and kind, its lead, its fill, its tail with the ground before each
 * part in pixels, and its forecast's line.
 */
const windowsOf = (page: Page) =>
  page.locator('[data-window]').evaluateAll((windows) =>
    windows.map((window) => {
      const account = window.closest<HTMLElement>('[data-account]')?.dataset.account
      const track = window.querySelector('[data-mark="track"]')?.getBoundingClientRect()
      const fill = window.querySelector('[data-mark="fill"]')
      const width = track?.width || 1
      // To the half percent, so a share such as 12.5 % reads as itself and not as a rounding.
      const share = (at: number) => Math.round(((at - (track?.left ?? 0)) / width) * 200) / 2
      const parts = [...window.querySelectorAll('[data-mark="ahead"]')].map((part) =>
        part.getBoundingClientRect(),
      )
      return {
        key: `${account ?? ''} ${(window as HTMLElement).dataset.window ?? ''}`,
        lead: (window.querySelector('.quota-window-lead')?.textContent ?? '')
          .replaceAll(/\s+/gu, ' ')
          .trim(),
        state: (window as HTMLElement).dataset.state ?? '',
        fill: fill ? share(fill.getBoundingClientRect().right) : null,
        solid: !fill || getComputedStyle(fill).maskImage === 'none',
        tail: parts.map(({ left, right, top, bottom }, index) => {
          const before = index === 0 ? fill?.getBoundingClientRect() : parts[index - 1]
          const gap = before ? left - before.right : 0
          const inside =
            track !== undefined &&
            left >= track.left - 0.5 &&
            right <= track.right + 0.5 &&
            top >= track.top - 0.5 &&
            bottom <= track.bottom + 0.5
          return {
            from: share(left - gap),
            to: share(right),
            gap: before ? Math.round(gap * 10) / 10 : null,
            inside,
          }
        }),
        forecast: (window.querySelector('[data-fact="forecast"]')?.textContent ?? '')
          .replaceAll(/\s+/gu, ' ')
          .trim(),
        swatch: Boolean(window.querySelector('[data-fact="forecast"] [data-mark="hatch"]')),
        corridor: Boolean(window.querySelector('[data-mark="corridor"]')),
        legend: Boolean(window.querySelector('[data-key="ahead"]')),
      }
    }),
  )

/**
 * Where every window of the panel stands, its bar's track and its step line's head, plot and
 * axis, to the fraction of a pixel: two boxes a window and three a line.
 */
const boxes = (page: Page) =>
  page
    .locator(
      [
        '[data-window]',
        '[data-window] [data-mark="track"]',
        ...['head', 'plot', 'axis'].map((part) => `${LINES} [data-region="${part}"]`),
      ].join(', '),
    )
    .evaluateAll((parts) => parts.map((part) => part.getBoundingClientRect().toJSON() as unknown))

/** Opens a section's panel drawn as charts, its five accounts read and their spending too. */
async function openDrawn(page: Page, section: string, accounts = 5) {
  await openPanel(page, pageAt({ by: section }))
  await expect(page.locator('[data-account]')).toHaveCount(accounts)
  await drawLined(page.locator('.chart-section').first())
  await expect(page.locator('.window-spend[data-state="loading"]')).toHaveCount(0)
  await page.evaluate(() => document.fonts.ready)
}

/** Where a place's hint stood once pointed at: by its mark, clear of the line's head. */
const hintOf = (page: Page, at: number, kind: string) =>
  page.evaluate(
    ({ lines, line, place }) => {
      const one = document.querySelectorAll(lines)[line]
      const hint = document.querySelector('[data-hint-surface]')?.getBoundingClientRect()
      const head = one?.querySelector('[data-region="head"]')?.getBoundingClientRect()
      const drawn = one?.querySelector(`[data-target="${place}"] [data-mark="place"]`)
      const painted = drawn?.checkVisibility({ opacityProperty: true }) ?? false
      const box = drawn?.getBoundingClientRect()
      if (!hint || !head || !box) return { painted, near: false, clear: false }
      const beside =
        Math.min(Math.abs(hint.left - box.right), Math.abs(box.left - hint.right)) < 12 &&
        Math.abs(hint.top - box.top) < 12
      const centred =
        Math.abs((hint.left + hint.right) / 2 - (box.left + box.right) / 2) < 2 &&
        Math.min(Math.abs(box.top - hint.bottom), Math.abs(hint.top - box.bottom)) < 12
      const clear =
        hint.bottom <= head.top ||
        hint.top >= head.bottom ||
        hint.right <= head.left ||
        hint.left >= head.right
      return { painted, near: beside || centred, clear }
    },
    { lines: LINES, line: at, place: kind },
  )

/** Where a place is pointed at: 4px into its stretch, from its start for «now», from its end for the forecast. */
const AIM = {
  now: (left: number) => left + 4,
  reset: (_: number, right: number) => right - 4,
} as Record<string, (left: number, right: number) => number>

/**
 * Points at each place past each line's readings, at its mark's height, and says where its hint
 * stood against its mark and the line's head, and whether anything moved. Each line stands in the
 * middle of the window first: at the window's edge the hint is moved to stay inside it.
 */
async function pointAtPlaces(page: Page, lines: LineAhead[]) {
  const strays: string[] = []
  for (const [at, line] of lines.entries())
    for (const { kind } of line.places) {
      const figure = page.locator(LINES).nth(at)
      await figure.evaluate((node) => node.scrollIntoView({ block: 'center' }))
      const still = JSON.stringify(await boxes(page))
      const target = figure.locator(`[data-target="${kind}"]`)
      const reach = (await target.boundingBox()) ?? { x: 0, y: 0, width: 0, height: 0 }
      const mark = await target.locator('[data-mark="place"]').boundingBox()
      const x = AIM[kind]?.(reach.x, reach.x + reach.width) ?? reach.x
      await page.mouse.move(x, (mark?.y ?? reach.y) + 4)
      await expect(page.getByRole('tooltip')).toBeVisible()
      const seen = await hintOf(page, at, kind)
      const moved = JSON.stringify(await boxes(page)) !== still
      strays.push(
        ...[
          [!seen.painted, 'its mark unpainted'],
          [!seen.near, 'its hint away from its mark'],
          [!seen.clear, "its hint over the line's head"],
          [moved, 'moved'],
        ].flatMap(([wrong, what]) => (wrong ? [`line ${at} ${kind}: ${String(what)}`] : [])),
      )
      await page.mouse.move(1, 1)
    }
  return strays
}

/** Whether a mark is painted, as it is only while pointed at or focused. */
const painted = (mark: Locator) =>
  mark.evaluate((node) => node.checkVisibility({ opacityProperty: true }))

/**
 * Points at the latest reading's dot on each line «now» follows, however close to now it was
 * read, and says where the pointer went instead of it: there the reading paints its own dot and
 * says its own hint, which stands at the dot as a point's does, and «now» stays unpainted.
 */
async function pointAtLatest(page: Page, lines: LineAhead[]) {
  const strays: string[] = []
  for (const [at, line] of lines.entries()) {
    if (!line.places.some(({ kind }) => kind === 'now')) continue
    const figure = page.locator(LINES).nth(at)
    await figure.evaluate((node) => node.scrollIntoView({ block: 'center' }))
    const dot = figure.locator('[data-reading]').last().locator('[data-mark="reading"]')
    const box = await dot.boundingBox()
    if (!box) {
      strays.push(`line ${at}: no latest reading`)
      continue
    }
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await expect(page.getByRole('tooltip')).toBeVisible()
    if (!(await painted(dot))) strays.push(`line ${at}: the latest reading's dot unpainted`)
    if (await painted(figure.locator('[data-target="now"] [data-mark="place"]')))
      strays.push(`line ${at}: «now» took the latest reading's dot`)
    const hint = await page.evaluate(latestHint, { lines: LINES, line: at })
    if (!hintAtDot(hint))
      strays.push(`line ${at}: the latest reading's hint off its dot ${JSON.stringify(hint)}`)
    await page.mouse.move(1, 1)
  }
  return strays
}

/** A window's state at the end of its lead: «fresh», or «silent» and for how long. */
const stateWords = (lang: 'en' | 'ru') => {
  const { states } = messages[lang].analytics.quota
  return {
    fresh: new RegExp(`· ${states.fresh}$`, 'u'),
    silent: new RegExp(`· ${states.silent} [0-9]`, 'u'),
  } as Record<string, RegExp>
}

for (const lang of ['en', 'ru'] as const)
  for (const width of [1440, 1024, 390])
    test(`at ${width}px in ${lang} a window's share is solid, its forecast a named hatch, its corridor and places in the plot`, async ({
      page,
    }, info) => {
      const words = messages[lang].analytics.quota
      const states = stateWords(lang)
      await page.addInitScript((chosen) => localStorage.setItem('valkama-locale', chosen), lang)
      await serve(page)
      await serveQuota(page, quotaOfEdges(NOW))
      await page.setViewportSize({ width, height: 1000 })
      const measured: Record<string, unknown> = {}
      for (const [section, cases] of [
        ['quota_five_hour', FIVE_HOURS],
        ['quota_week', WEEKS],
      ] as const) {
        await openDrawn(page, section)
        await page.mouse.move(1, 1)
        const windows = await windowsOf(page)
        const lines = await page.evaluate(aheadOfLines, LINES)
        measured[section] = { windows, lines }
        // A window a case, each with its step line, before anything is said of each.
        expect(windows, `${section}: its windows`).toHaveLength(Object.keys(cases).length)
        expect(lines, `${section}: a step line a window`).toHaveLength(windows.length)
        expect(await boxes(page), `${section}: the boxes held still`).toHaveLength(
          windows.length * 2 + lines.length * 3,
        )
        // Each window as its case draws it: the fill, the tail, the swatch, the corridor and the
        // places past its readings.
        const drawn = Object.fromEntries(
          windows.map((one, index) => [
            one.key,
            {
              fill: one.fill,
              tail: one.tail.map(({ from, to }) => [from, to]),
              swatch: one.swatch,
              corridor: one.corridor,
              places: lines[index]?.places.map(({ kind }) => kind) ?? [],
            },
          ]),
        )
        expect(drawn, `${section}: what each window draws`).toEqual(cases)
        for (const one of windows) {
          // The share spent is solid, silent or fresh; a silent window says for how long.
          expect(one.solid, `${one.key}: its fill solid`).toBe(true)
          expect(one.lead, `${one.key}: its state`).toMatch(states[one.state] ?? /^$/u)
          // Every part of the tail inside the track, 2px of ground past the fill or the part
          // before; the forecast after the hatch's key wherever there is one; the legend names
          // the corridor where one is drawn.
          expect(
            one.tail.every(({ inside }) => inside),
            `${one.key}: its tail in its track`,
          ).toBe(true)
          expect(
            one.tail.map(({ gap }) => gap),
            `${one.key}: the ground before each part`,
          ).toEqual(one.tail.map((_, index) => (index === 0 && one.fill === null ? null : 2)))
          expect(one.forecast.startsWith(`${words.forecastKey} · `), `${one.key}: the key`).toBe(
            one.forecast !== words.forecast.none,
          )
          expect(one.legend, `${one.key}: the corridor named`).toBe(one.corridor)
        }
        // The hatch's swatch hangs in the card's start gutter: the forecast line's words start
        // where the reset's under them do, and the swatch stands whole inside the card.
        const keyed = await swatchLines(page)
        measured[`${section} swatches`] = keyed
        expect(keyed, `${section}: the windows keyed by a swatch`).toHaveLength(
          Object.values(cases).filter(({ swatch }) => swatch).length,
        )
        for (const one of keyed) {
          expect(
            Math.abs(one.forecast - one.reset),
            `${one.key}: the forecast's words at ${one.forecast}, the reset's at ${one.reset}`,
          ).toBeLessThanOrEqual(0.5)
          expect({ inCard: one.inCard, seen: one.seen }, `${one.key}: its swatch`).toEqual({
            inCard: true,
            seen: true,
          })
        }
        for (const [index, line] of lines.entries())
          expect(cornersOutside(line), `line ${index}: corners outside its plot`).toEqual([])
        expect(await pointAtPlaces(page, lines), `${section}: places pointed at`).toEqual([])
        expect(await pointAtLatest(page, lines), `${section}: latest readings`).toEqual([])
      }
      await record(info, `forecast ${width} ${lang}`, measured)
    })

/**
 * How the forecast's keys are painted against what they name, as the browser resolves them: the
 * swatch at the head of a window's forecast line (`QuotaWindow`) and the forecast's key in its
 * step line's head (`StepLineHead`), each against the first part of the window's tail; whether
 * each is hatched, as the tail is and the fill never is; and the palette's text ink.
 */
const forecastKeys = (page: Page, window: string) =>
  page
    .locator(`[data-window="${window}"]`)
    .first()
    .evaluate((found) => {
      const probe = document.createElement('i')
      document.body.append(probe)
      probe.style.color = 'CanvasText'
      const ink = getComputedStyle(probe).color
      probe.remove()
      const drawn = (selector: string) => {
        const element = found.querySelector(selector)
        if (!element) return null
        const style = getComputedStyle(element)
        return {
          paint: style.backgroundColor,
          hatched: style.maskImage.includes('repeating-linear-gradient'),
        }
      }
      return {
        ink,
        tail: drawn('[data-mark="ahead"]'),
        fill: drawn('[data-mark="fill"]'),
        swatch: drawn('[data-fact="forecast"] [data-mark="hatch"]'),
        legend: drawn('[data-chart="steps"] [data-key="ahead"] [data-mark="hatch"]'),
      }
    })

/** The two palettes: the page's own, and a forced one, which draws the tail in its text ink. */
const PALETTES = [
  { forcedColors: 'none', name: '', ink: false },
  { forcedColors: 'active', name: 'in a forced palette ', ink: true },
] as const

for (const { forcedColors, name, ink } of PALETTES)
  test(`${name}the forecast's keys are hatched and painted as its tail is, the fill not hatched`, async ({
    page,
  }, info) => {
    await page.emulateMedia({ forcedColors })
    await serve(page)
    await serveQuota(page, quotaOfEdges(NOW))
    await page.setViewportSize({ width: 1440, height: 1000 })
    await openDrawn(page, 'quota_five_hour')
    // «Work»'s five hours: a fill, a tail to the track's end, its swatch and its corridor named.
    const keys = await forecastKeys(page, 'five_hour')
    await record(info, `forecast keys ${forcedColors}`, keys)
    const tail = keys.tail?.paint ?? 'no tail'
    expect(
      {
        tail: keys.tail?.hatched,
        fill: keys.fill?.hatched,
        swatch: keys.swatch,
        legend: keys.legend,
      },
      'what is hatched, and the keys painted as the tail',
    ).toEqual({
      tail: true,
      fill: false,
      swatch: { paint: tail, hatched: true },
      legend: { paint: tail, hatched: true },
    })
    expect(tail === keys.ink, 'the tail in the text ink').toBe(ink)
  })

test('a window past its reset draws no tail, no corridor and no place past its readings', async ({
  page,
}) => {
  // Read five hours ago: every five hours has reset since, every week still stands.
  await serve(page)
  await serveQuota(page, quotaAt(NOW.getTime() - 5 * HOUR))
  await page.setViewportSize({ width: 1024, height: 1000 })
  await openDrawn(page, 'quota_five_hour', 4)
  const windows = await windowsOf(page)
  const lines = await page.evaluate(aheadOfLines, LINES)
  expect(windows.map(({ key, tail, swatch, corridor }) => [key, tail, swatch, corridor])).toEqual([
    ['Work five_hour', [], false, false],
    ['7e6d5c4b five_hour', [], false, false],
    ['a1b2c3d4 five_hour', [], false, false],
  ])
  expect(lines.map(({ places }) => places)).toEqual([[], [], []])
  // No forecast is said either, the reset in its place.
  expect(windows.map(({ forecast }) => forecast)).toEqual(['', '', ''])
  await expect(page.locator('[data-window] [data-fact="reset"]')).toHaveCount(3)
  // The line is the whole window alone, with nothing to switch to.
  const switches = page.locator(LINES).getByRole('radiogroup')
  await expect(switches).toHaveCount(0)
  // The control: every week still stands, and each of its lines has its switch.
  await openDrawn(page, 'quota_week', 4)
  const weeks = await page.locator(LINES).count()
  expect(weeks, 'the weeks drawn').toBeGreaterThan(0)
  await expect(switches).toHaveCount(weeks)
})
