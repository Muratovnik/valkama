/**
 * The Volumes page's layout at the widths the shell takes each of its forms in — 1280, 1024, 760,
 * 620 and 390px — in both languages, scrollbars drawn, on the longest data the page meets: counts
 * of four figures, ages of months, a goal six levels deep under titles of a sentence and a half,
 * and commits whose subjects and repositories run long. The oracle is DESIGN.md: the figures of a
 * row of numbers stand at one height (System rules, «A KPI figure»); a row's action stands in the
 * columns read first, so «Attach to a card» is in the commits' frame, and a table stands by whether
 * its columns fit its frame (Rows and tables): at 1280 every column of the goals stands in it, and
 * the commits, stacked where their columns do not fit, never scroll sideways or cut a word; a
 * goal's title keeps a width of its own whatever its indent while the table has room for it, and
 * comes down to no less than its longest word where it has not, and the parent it names stands
 * under it on its edge (Volumes) — held to 11rem, the titles left «Left ≈» past the frame at 1280;
 * on a phone the periods stand whole in their row,
 * and no row is held for the reader's own days until they are chosen (Analytics, the bar). Each
 * run prints what it measured.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { goalRow, spentOf, volumesAnswer } from '../support/volumesDouble.ts'
import { record } from './analyticsPage.ts'
import { installBackend } from './backend.ts'
import { spaceScope } from './planningFixtures.ts'
import { test } from './test.ts'

const WIDTHS = [1280, 1024, 760, 620, 390] as const

const WORDS = {
  en: {
    commits: 'Commits on no card',
    attach: 'Attach to a card',
    period: 'Period',
    goals: 'Goals',
  },
  ru: {
    commits: 'Коммиты без карточки',
    attach: 'Прикрепить к карточке',
    period: 'Период',
    goals: 'Цели',
  },
} as const

/** The space between the bar's last control and the first number: the bar's foot and the panel's top. */
const BAND = 16 + 12

const TITLE =
  'Move the volumes read onto the new work model, counting what each stage spent and judging the estimates by the closed tasks of the alpha/beta/gamma service'

/** The least width a goal's words keep whatever its indent while the table has room: 11rem. */
const WORDS_LEAST = 11 * 16

/**
 * How far a column of the goals may stand past the frame, by width: none at the layouts' desktop;
 * at the narrower ones they scroll where even their least does not fit.
 */
const GOALS_PAST: Partial<Record<number, number>> = { 1280: 0.5 }

/** The least width of a goal's words by the goals' step: their longest word's alone at `least`. */
const WORDS_LEAST_AT: Partial<Record<string, number>> = { least: 0 }

/** A goal six levels deep, each level under a title of a sentence and a half, with large figures. */
function deepGoals() {
  let deep = goalRow({
    reference: 'MAIN-17',
    kind: 'stage',
    parent: 'MAIN-16',
    title: TITLE,
    total: 12,
    closed: 3,
    spent: spentOf(123 * 3600 + 45 * 60, 12_345_678),
    spentWithCancelled: spentOf(234 * 3600 + 5 * 60, 23_456_789),
    remaining: { seconds: 98 * 3600, anew: 9_876_543, basis: 17, estimated: 5, unestimated: 2 },
  })
  for (let level = 6; level >= 1; level -= 1)
    deep = goalRow({
      reference: `MAIN-1${level}`,
      kind: level === 1 ? 'goal' : 'stage',
      parent: level === 1 ? null : `MAIN-1${level - 1}`,
      title: `${TITLE} (level ${level})`,
      total: 120,
      closed: 33,
      baseline: 140,
      spent: spentOf(1234 * 3600 + 45 * 60, 123_456_789),
      spentWithCancelled: spentOf(2345 * 3600 + 5 * 60, 234_567_890),
      remaining: {
        seconds: 987 * 3600,
        anew: 98_765_432,
        basis: 170,
        estimated: 50,
        unestimated: 2,
      },
      children: [deep],
    })
  return [deep]
}

/** Commits on no card with long subjects and a repository named at length. */
const COMMITS = Array.from({ length: 3 }, (_, at) => ({
  repository: 'alpha-service-backend',
  display_name: 'Alpha service backend monorepo',
  hash: `abcdef0${at}23456789`,
  subject:
    'Fix the parser of the volumes read so that a goal of eight levels sums its stages and reports the tasks begun before usage was counted',
  committed_at: '2026-03-02T10:00:00Z',
  session: 'c0ffee00-1111-4222-8333-444455556666',
  agent: null,
  client: 'claude',
  reported_at: '2026-03-02T10:00:05Z',
}))

async function openPage(page: Page, width: number) {
  await installBackend(page)
  // Routed after the backend's own, so these answer.
  await page.route('**/api/planning/volumes?*', (route) =>
    route.fulfill({
      json: volumesAnswer({
        categories: {
          triage: 1234,
          deferred: 12,
          ready: 345,
          active: 67,
          review: 8,
          completed: 1234,
          blocked: 3,
          cancelled: 99,
        },
        waiting: 23,
        unattached: 1234,
        goals: deepGoals(),
      }),
    }),
  )
  await page.route('**/api/planning/commits/unattached?*', (route) =>
    route.fulfill({ json: { total: COMMITS.length, items: COMMITS } }),
  )
  await page.setViewportSize({ width, height: 900 })
  await page.goto(serializePlatformRoute({ module_id: 'volumes', scope: spaceScope, state: {} }))
  await expect(page.locator('[data-number]')).toHaveCount(10)
  await page.evaluate(() => document.fonts.ready)
}

/**
 * How a table stands in its frame: how far its widest cell or heading reaches past the frame's
 * inner edges, what is left to scroll sideways, its step and the words its cells break inside, a
 * word being broken when its letters stand on more than one line.
 */
const tableFit = (page: Page, region: string) =>
  page.getByRole('region', { name: region, exact: true }).evaluate((section) => {
    const frame = section.querySelector<HTMLElement>('[data-region="table-frame"]')
    if (!frame) return null
    const box = frame.getBoundingClientRect()
    const left = box.left + frame.clientLeft
    const right = left + frame.clientWidth
    const cells = [...frame.querySelectorAll('th, td')]
    const past = Math.max(
      0,
      ...cells.map((one) => {
        const own = one.getBoundingClientRect()
        return Math.max(left - own.left, own.right - right)
      }),
    )
    const broken: string[] = []
    const walker = document.createTreeWalker(frame, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      for (const found of (node.textContent ?? '').matchAll(/[^\s/]+/gu)) {
        const range = document.createRange()
        range.setStart(node, found.index)
        range.setEnd(node, found.index + found[0].length)
        const lines = new Set(
          [...range.getClientRects()]
            .filter((rect) => rect.width > 0)
            .map((rect) => Math.round(rect.top)),
        )
        if (lines.size > 1) broken.push(found[0])
      }
    }
    return {
      fit: section.closest<HTMLElement>('[data-fit]')?.dataset.fit,
      past,
      sideways: frame.scrollWidth - frame.clientWidth,
      broken,
    }
  })

/** The numbers by the row they stand in: for each row, the top of each figure. */
const figureRows = (page: Page) =>
  page.locator('[data-number]').evaluateAll((numbers) => {
    const rows = new Map<number, number[]>()
    for (const number of numbers) {
      const top = Math.round(number.getBoundingClientRect().top)
      const figure = number.querySelector('[data-part="figure"]')?.getBoundingClientRect().top
      rows.set(top, [...(rows.get(top) ?? []), figure ?? Number.NaN])
    }
    return [...rows.values()]
  })

// Playwright hides scrollbars, and one that arrives narrows what it scrolls on a real screen.
test.use({ launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] } })

for (const lang of ['en', 'ru'] as const)
  for (const width of WIDTHS)
    test.describe(`Volumes' layout, ${lang} at ${width}px`, () => {
      test.use({ locale: lang === 'ru' ? 'ru-RU' : 'en-US' })
      const words = WORDS[lang]

      test('figures, actions, titles and the bar stand where the rules put them', async ({
        page,
      }, info) => {
        await openPage(page, width)

        // The figures of each row of numbers at one height.
        const rows = await figureRows(page)
        expect(rows.flat()).toHaveLength(10)
        const spreads = rows.map((tops) => Math.max(...tops) - Math.min(...tops))
        for (const spread of spreads) expect.soft(spread).toBeLessThanOrEqual(0.5)

        // On a phone and wider: every period whole in its row, nothing scrolled sideways.
        const strip = page.getByRole('radiogroup', { name: words.period })
        const periods = await strip.evaluate((group) => {
          const row = group.getBoundingClientRect()
          const options = [...group.querySelectorAll('[role="radio"]')].map((one) => {
            const box = one.getBoundingClientRect()
            return Math.max(row.left - box.left, box.right - row.right, 0)
          })
          return { options, sideways: group.scrollWidth - group.clientWidth }
        })
        expect(periods.options).toHaveLength(4)
        for (const past of periods.options) expect.soft(past).toBeLessThanOrEqual(0.5)
        expect.soft(periods.sideways).toBeLessThanOrEqual(0)

        // No room held between the bar and the numbers for days nobody chose.
        const band = await page.evaluate(() => {
          const controls = [
            ...document.querySelectorAll(
              '.period-bar :is([role="radiogroup"], [role="combobox"], button)',
            ),
          ].map((one) => one.getBoundingClientRect().bottom)
          const first = document.querySelector('[data-number]')?.getBoundingClientRect().top ?? 0
          return first - Math.max(...controls)
        })
        expect.soft(band).toBeLessThanOrEqual(BAND + 0.5)

        // «Attach to a card» in the commits' frame before any sideways scroll.
        await page.locator('[data-number="commits"]').click()
        const commits = page.getByRole('region', { name: words.commits })
        await expect(commits.locator('[data-commit]')).toHaveCount(3)
        const frame = commits.locator('[data-region="table-frame"]')
        await expect(
          commits.locator('[data-commit]').first().getByRole('button', { name: words.attach }),
        ).toBeVisible()
        const attachPast = await frame.evaluate((element, name) => {
          const box = element.getBoundingClientRect()
          const attach = [...element.querySelectorAll('[data-commit] button')].find(
            (one) => one.textContent?.trim() === name,
          )
          const own = attach?.getBoundingClientRect()
          return own ? Math.max(box.left - own.left, own.right - box.right, 0) : Number.NaN
        }, words.attach)
        expect.soft(attachPast).toBeLessThanOrEqual(0.5)

        // The commits stand in their frame at every width, as columns or as blocks, and no word of
        // theirs is cut: on a phone, scrolling sideways, the repository's name was cut inside a word.
        const commitsFit = await tableFit(page, words.commits)
        expect(commitsFit).not.toBeNull()
        expect.soft(commitsFit?.past).toBeLessThanOrEqual(0.5)
        expect.soft(commitsFit?.sideways).toBeLessThanOrEqual(0)
        expect.soft(commitsFit?.broken).toEqual([])
        expect.soft(width >= 600 || commitsFit?.fit === 'stack', 'stacked on a phone').toBe(true)

        // The deepest goal's title keeps its width, and the parent it names stands on its edge.
        const deepest = page.locator('tr[data-reference="MAIN-17"]')
        const title = await deepest.locator('[data-part="title"]').boundingBox()
        const detail = await deepest.locator('[data-part="detail"]').boundingBox()
        const reference = await deepest.locator('[data-part="reference"]').boundingBox()
        expect(title && detail && reference).toBeTruthy()
        const goal = {
          title: title?.width ?? 0,
          detailOff: Math.abs((detail?.x ?? Number.NaN) - (title?.x ?? Number.NaN)),
          referenceOff: Math.abs((reference?.x ?? Number.NaN) - (title?.x ?? Number.NaN)),
        }
        const goalsFit = await tableFit(page, words.goals)
        expect(goalsFit).not.toBeNull()
        // The words keep 11rem unless every column stands in the frame only without it, and are
        // never narrower than their longest word.
        expect
          .soft(goal.title)
          .toBeGreaterThanOrEqual((WORDS_LEAST_AT[goalsFit?.fit ?? ''] ?? WORDS_LEAST) - 0.5)
        expect.soft(goalsFit?.broken).toEqual([])
        expect.soft(goal.detailOff).toBeLessThanOrEqual(0.5)
        expect.soft(goal.referenceOff).toBeLessThanOrEqual(0.5)
        // At the layouts' desktop every column of the goals stands in the frame, «Left ≈» with them.
        const whole = GOALS_PAST[width] ?? Number.POSITIVE_INFINITY
        expect.soft(goalsFit?.past).toBeLessThanOrEqual(whole)
        expect.soft(goalsFit?.sideways).toBeLessThanOrEqual(whole)

        await record(info, `volumes layout ${lang} ${width}`, {
          spreads,
          periods,
          band,
          attachPast,
          goal,
          goalsFit,
          commitsFit,
        })
      })
    })
