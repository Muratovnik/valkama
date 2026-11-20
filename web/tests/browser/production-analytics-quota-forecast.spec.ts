/**
 * How the quota draws a window's forecast in the real app, at the widths it is used at — 1440,
 * 1024 and 390 pixels — in English and in Russian, drawn as charts. The oracle is the rule of the
 * hatch: a figure not final yet is hatched and named, a final one never is.
 *
 * Every window's share spent is solid, a silent one's too, which says in words how long it has
 * been silent. Its forecast is one hatched tail inside the track, from the share spent: a week's
 * range to its high end, with no gap inside it; five hours that last to the share their
 * answer says they spend by the reset; five hours that run out to the track's end; none for a
 * window too new for a forecast, for one spent or read past 100 %; and from the track's start at
 * 0 %. The
 * forecast's line, right under the tail, leads with «Forecast ·», the name the step line's legend
 * gives its dashed line, and draws nothing but its words: they start where the reset's do, and
 * nothing of the line stands left of them.
 * Each step line past its readings points at «now» and, where a forecast has a share to draw to,
 * runs its dashed line on toward the reset and points at its end: the line and its range inside
 * the plot, each place's hint at its mark and clear of the line's head, nothing moving while
 * pointed at; the latest reading keeps its own dot beyond a mark's reach of «now», and within it is
 * found as «now», whose hint says its share. A window
 * spent already has run out at now, so no line runs on from there; a window past its reset draws
 * neither. Each run attaches what it measured.
 *
 * Every part is read by the hook its component documents (`QuotaAccount`, `QuotaWindow`,
 * `WindowBar`, `StepLine`), and every set is held to the size its case gives before anything is
 * said of each of its members.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { messages } from '@/shared/i18n/index.ts'

import {
  NIGHT_NAME,
  nightName,
  quotaAt,
  quotaOfEdges,
  SEATED_NAME,
  seatedName,
} from '../fixtures/quota.ts'
import { NOW, openPanel, pageAt, record, serve, serveQuota } from './analyticsPage.ts'
import { drawLined } from './drawnViews.ts'
import { pointAtLatest } from './latestReading.ts'
import { forecastLines } from './quotaForecastLine.ts'
import { aheadOfLines, cornersOutside } from './stepAhead.ts'
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
  /** Whether the step line runs a forecast's line, and the places past its readings it points at. */
  ahead: boolean
  /** Where the fill ends, or null for none. */
  fill: number | null
  places: string[]
  tail: [number, number][]
}

const FIVE_HOURS: Record<string, Drawn> = {
  'Work five_hour': {
    fill: 62,
    tail: [[62, 100]],
    ahead: true,
    places: ['now', 'reset'],
  },
  // A fresh 0 % that lasts to the reset: the tail from the track's start to the 35 % its answer
  // says it spends by then (DESIGN.md, `WindowBar`).
  [`${NIGHT_NAME} five_hour`]: {
    fill: null,
    tail: [[0, 35]],
    ahead: true,
    places: ['now', 'reset'],
  },
  [`${SEATED_NAME} five_hour`]: {
    fill: 74,
    tail: [[74, 100]],
    ahead: true,
    places: ['now', 'reset'],
  },
  // Spent: nothing past the fill, and nothing ahead on the line either: it ran out at now.
  'Edge five_hour': {
    fill: 100,
    tail: [],
    ahead: false,
    places: ['now'],
  },
}

const WEEKS: Record<string, Drawn> = {
  'Work week': {
    fill: 41,
    tail: [[41, 61]],
    ahead: true,
    places: ['now', 'reset'],
  },
  'Work week_model': { fill: 12.5, tail: [], ahead: false, places: ['now'] },
  // Silent, its share as solid as a fresh one's, and a range that may run out, cut at the end.
  [`${NIGHT_NAME} week`]: {
    fill: 88,
    tail: [[88, 100]],
    ahead: true,
    places: ['now', 'reset'],
  },
  [`${SEATED_NAME} week`]: { fill: 20, tail: [], ahead: false, places: ['now'] },
  // Read past 100 %: the fill stops at the track's end and nothing is ahead of it, on the line too.
  'Edge week': { fill: 100, tail: [], ahead: false, places: ['now'] },
  // A fresh 0 %: no fill, the tail from the track's start.
  'Edge week_model': {
    fill: null,
    tail: [[0, 9]],
    ahead: true,
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
        ahead: Boolean(window.querySelector('[data-mark="forecast"]')),
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

/** Opens a section's panel drawn as charts, its five accounts read. */
async function openDrawn(page: Page, section: string, accounts = 5) {
  await openPanel(page, pageAt({ by: section }))
  await expect(page.locator('[data-account]')).toHaveCount(accounts)
  await drawLined(page.locator('.chart-section').first())
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
      // Level with the mark's top, or, where the line could not be scrolled to the window's
      // middle, as the last line of the page cannot, moved up to keep 8px inside the window, still
      // beside the mark's height.
      const kept = hint.bottom >= innerHeight - 9 && hint.top <= box.top && box.top <= hint.bottom
      const beside =
        Math.min(Math.abs(hint.left - box.right), Math.abs(box.left - hint.right)) < 12 &&
        (Math.abs(hint.top - box.top) < 12 || kept)
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

/**
 * Where a place is pointed at, from the middle of its mark, where the pointer finds it (`DESIGN.md`,
 * the step line): 4px on for «now», along the line past it, and 4px back for the forecast.
 */
const AIM = {
  now: (middle: number) => middle + 4,
  reset: (middle: number) => middle - 4,
} as Record<string, (middle: number) => number>

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
      const middle = mark ? mark.x + mark.width / 2 : reach.x + reach.width / 2
      const x = AIM[kind]?.(middle) ?? middle
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

/** The cases as a language says them: each account whose weekly reset is known names it in it. */
const casesIn = (cases: Record<string, Drawn>, lang: 'en' | 'ru') =>
  Object.fromEntries(
    Object.entries(cases).map(([key, drawn]) => [
      key.replace(SEATED_NAME, seatedName(lang)).replace(NIGHT_NAME, nightName(lang)),
      drawn,
    ]),
  )

/** A window's state at the end of its lead: «up to date», or «no data» and for how long. */
const stateWords = (lang: 'en' | 'ru') => {
  const { states, silentFor } = messages[lang].analytics.quota
  return {
    fresh: new RegExp(`· ${states.fresh}$`, 'u'),
    silent: new RegExp(`· ${silentFor.replace('{for}', '[0-9]')}`, 'u'),
  } as Record<string, RegExp>
}

for (const lang of ['en', 'ru'] as const)
  for (const width of [1440, 1024, 390])
    test(`at ${width}px in ${lang} a window's share is solid, its forecast a named hatch, its line and places in the plot`, async ({
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
        ['quota_five_hour', casesIn(FIVE_HOURS, lang)],
        ['quota_week', casesIn(WEEKS, lang)],
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
        // Each window as its case draws it: the fill, the tail, the forecast's line and the places
        // past its readings.
        const drawn = Object.fromEntries(
          windows.map((one, index) => [
            one.key,
            {
              fill: one.fill,
              tail: one.tail.map(({ from, to }) => [from, to]),
              ahead: one.ahead,
              places: lines[index]?.places.map(({ kind }) => kind) ?? [],
            },
          ]),
        )
        expect(drawn, `${section}: what each window draws`).toEqual(cases)
        for (const one of windows) {
          // The share spent is solid, silent or fresh; a silent window says for how long.
          expect(one.solid, `${one.key}: its fill solid`).toBe(true)
          expect(one.lead, `${one.key}: its state`).toMatch(states[one.state] ?? /^$/u)
          // The one tail inside the track, 2px of ground past the fill; the forecast after its
          // name wherever there is one; the legend names the forecast's line where one is drawn.
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
          expect(one.legend, `${one.key}: the forecast's line named`).toBe(one.ahead)
        }
        // The forecast's line is its words alone, flush with the reset's under them: nothing of
        // it stands left of where they start.
        const said = await forecastLines(page)
        measured[`${section} forecast lines`] = said
        expect(said, `${section}: the forecast lines`).toHaveLength(Object.keys(cases).length)
        for (const one of said) {
          expect(
            Math.abs(one.forecast - one.reset),
            `${one.key}: the forecast's words at ${one.forecast}, the reset's at ${one.reset}`,
          ).toBeLessThanOrEqual(0.5)
          expect(one.leftmost, `${one.key}: the leftmost of its line`).toBeGreaterThanOrEqual(
            one.reset - 0.5,
          )
          expect(one.marks, `${one.key}: what it draws besides its words`).toBe(0)
        }
        for (const [index, line] of lines.entries())
          expect(cornersOutside(line), `line ${index}: corners outside its plot`).toEqual([])
        expect(await pointAtPlaces(page, lines), `${section}: places pointed at`).toEqual([])
        expect(await pointAtLatest(page, lines, LINES), `${section}: latest readings`).toEqual([])
      }
      await record(info, `forecast ${width} ${lang}`, measured)
    })

/**
 * How the forecast is painted against what names it, as the browser resolves it: the bar's tail
 * and its fill, whether each is hatched, as the tail is and the fill never is; the step line's
 * forecast, its stroke and its dashes; the forecast's key in the line's head (`StepLineHead`), the
 * paint of its swatch and whether it is a dashed line or a hatch; and the palette's text ink.
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
      const line = found.querySelector('[data-chart="steps"] [data-mark="forecast"]')
      const key = found.querySelector('[data-chart="steps"] [data-key="ahead"] [data-mark="dash"]')
      const paint = line ? getComputedStyle(line) : null
      const swatch = key ? getComputedStyle(key) : null
      return {
        ink,
        tail: drawn('[data-mark="ahead"]'),
        fill: drawn('[data-mark="fill"]'),
        line: paint ? { stroke: paint.stroke, dashed: paint.strokeDasharray !== 'none' } : null,
        legend: swatch ? { paint: swatch.backgroundColor, mask: swatch.maskImage } : null,
      }
    })

/** The two palettes: the page's own, and a forced one, which draws the tail in its text ink. */
const PALETTES = [
  { forcedColors: 'none', name: '', ink: false },
  { forcedColors: 'active', name: 'in a forced palette ', ink: true },
] as const

for (const { forcedColors, name, ink } of PALETTES)
  test(`${name}the bar's tail is hatched, the fill not, and the forecast's key a dashed line painted as the line is`, async ({
    page,
  }, info) => {
    await page.emulateMedia({ forcedColors })
    await serve(page)
    await serveQuota(page, quotaOfEdges(NOW))
    await page.setViewportSize({ width: 1440, height: 1000 })
    await openDrawn(page, 'quota_five_hour')
    // «Work»'s five hours: a fill, a tail to the track's end and its forecast's line named.
    const keys = await forecastKeys(page, 'five_hour')
    await record(info, `forecast keys ${forcedColors}`, keys)
    const tail = keys.tail?.paint ?? 'no tail'
    const stroke = keys.line?.stroke ?? 'no line'
    expect(
      {
        tail: keys.tail?.hatched,
        fill: keys.fill?.hatched,
        line: keys.line?.dashed,
      },
      'what is hatched and what is dashed',
    ).toEqual({ tail: true, fill: false, line: true })
    // The key's swatch is a short dashed line of the line's own paint: dashes across, never the
    // hatch's slant.
    expect(keys.legend?.paint, "the key in the line's paint").toBe(stroke)
    expect(keys.legend?.mask, 'the key dashed across').toMatch(
      /^repeating-linear-gradient\((to right|90deg), /u,
    )
    expect(tail === keys.ink, 'the tail in the text ink').toBe(ink)
    expect(stroke === keys.ink, "the forecast's line in the text ink").toBe(ink)
  })

test('a window past its reset draws no tail, no forecast and no place past its readings', async ({
  page,
}) => {
  // Read five hours ago: every five hours has reset since, every week still stands.
  await serve(page)
  await serveQuota(page, quotaAt(NOW.getTime() - 5 * HOUR))
  await page.setViewportSize({ width: 1024, height: 1000 })
  await openDrawn(page, 'quota_five_hour', 4)
  const windows = await windowsOf(page)
  const lines = await page.evaluate(aheadOfLines, LINES)
  expect(windows.map(({ key, tail, ahead }) => [key, tail, ahead])).toEqual([
    ['Work five_hour', [], false],
    [`${NIGHT_NAME} five_hour`, [], false],
    [`${SEATED_NAME} five_hour`, [], false],
  ])
  expect(lines.map(({ places }) => places)).toEqual([[], [], []])
  // No forecast is said either: each leads with its reset (DESIGN.md § Analytics).
  expect(windows.map(({ forecast }) => forecast)).toEqual(['', '', ''])
  await expect(page.locator('[data-window] [data-lead="ended"]')).toHaveCount(3)
  // Each line is drawn in the neutral ink, as its bar is, its right end the reset that has passed.
  const ends = page.locator(`${LINES} [data-region="axis"] [data-moment="to"]`)
  await expect(page.locator(`${LINES}[data-muted]`)).toHaveCount(3)
  await expect(ends).toHaveText(Array.from({ length: 3 }, () => /^reset at \d{2}:\d{2}$/u))
  // The control: every week and model's week still stands, drawn in its hue and named by the
  // reset ahead.
  await openDrawn(page, 'quota_week', 4)
  await expect(page.locator(LINES)).toHaveCount(4)
  await expect(page.locator(`${LINES}[data-muted]`)).toHaveCount(0)
  await expect(ends).toHaveText(Array.from({ length: 4 }, () => /^resets /u))
})
