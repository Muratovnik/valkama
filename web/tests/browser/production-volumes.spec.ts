/**
 * The Volumes page in the real app, against a double of the server's read (`volumesDouble`), at
 * 1280px in English and at 390px in English and in Russian. The oracle is the page's contract in
 * DESIGN.md («Volumes»): the ten numbers stand in one row, or in two rows of five on a phone; a
 * goal's volume and what it has left are read on its row of the goals' tree, a goal of five
 * levels among them; an open category's number opens the board narrowed to it; a space without
 * goals says so and counts its work outside goals; and the page's states — spending not counted,
 * no work, a refresh that failed — say so in its words. A long tree's frame is held to the
 * panel's height, so the table never runs past the window, whatever the bar's rows. Each run
 * prints what it measured and keeps a picture of each state.
 */
import { expect } from '@playwright/test'
import type { Page, TestInfo } from '@playwright/test'

import { parsePlatformRoute, serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { goalRow, spentOf, volumesAnswer } from '../support/volumesDouble.ts'
import { record, shortfalls } from './analyticsPage.ts'
import { installBackend } from './backend.ts'
import { spaceScope } from './planningFixtures.ts'
import { test } from './test.ts'

const WORDS = {
  en: {
    noGoals: 'There are no goals in this scope',
    empty: 'There is no work in this scope',
    refreshFailed: 'Could not refresh.',
    closed: '3 of 6',
    left: '≈\u{A0}5\u{A0}h · 40K',
    basis: 'by 7 tasks',
    unknown: 'Not counted: its tasks began before usage was counted.',
    outside: '3 tasks outside goals',
  },
  ru: {
    noGoals: 'В этом охвате нет целей',
    empty: 'В этом охвате нет работы',
    refreshFailed: 'Не удалось обновить.',
    closed: '3 из 6',
    left: '≈\u{A0}5\u{A0}ч · 40\u{A0}тыс.',
    basis: 'по 7 задачам',
    unknown: 'Не посчитано: её задачи начаты до начала учёта расхода.',
    outside: '3 задачи вне целей',
  },
} as const

const SIZES = [
  { lang: 'en', width: 1280, height: 800 },
  { lang: 'en', width: 390, height: 844 },
  { lang: 'ru', width: 390, height: 844 },
] as const

const pageAt = (state: Record<string, string> = {}) =>
  serializePlatformRoute({ module_id: 'volumes', scope: spaceScope, state })

/** A goal whose two stages hold all its work, and a goal of five levels. */
function goals() {
  const stages = [
    goalRow({
      reference: 'MAIN-11',
      kind: 'stage',
      parent: 'MAIN-10',
      total: 4,
      closed: 1,
      spent: spentOf(3600, 10_000),
      spentWithCancelled: spentOf(7200, 30_000),
    }),
    goalRow({
      reference: 'MAIN-12',
      kind: 'stage',
      parent: 'MAIN-10',
      total: 2,
      closed: 2,
      spent: spentOf(7200, 20_000),
    }),
  ]
  const sought = goalRow({
    reference: 'MAIN-10',
    title: 'Ship the volumes page',
    total: 6,
    closed: 3,
    baseline: 5,
    spent: spentOf(3 * 3600, 30_000),
    spentWithCancelled: spentOf(4 * 3600, 50_000),
    remaining: { seconds: 5 * 3600, anew: 40_000, basis: 7, estimated: 3, unestimated: 0 },
    children: stages,
  })
  let deep = goalRow({ reference: 'MAIN-25', kind: 'stage', parent: 'MAIN-24', total: 1 })
  for (let level = 4; level >= 1; level -= 1)
    deep = goalRow({
      reference: `MAIN-${20 + level}`,
      kind: level === 1 ? 'goal' : 'stage',
      parent: level === 1 ? null : `MAIN-${19 + level}`,
      total: 1,
      baselineAbsent: level === 1 ? 'migrated' : null,
      spent: level === 1 ? spentOf(0, null, 1) : undefined,
      children: [deep],
    })
  return [sought, deep]
}

const READY = {
  categories: {
    triage: 4,
    deferred: 1,
    ready: 2,
    active: 3,
    review: 1,
    completed: 3,
    cancelled: 1,
  },
  waiting: 2,
  unattached: 1,
  outside: {
    byProject: [
      { project: 'alpha', tasks: 2 },
      { project: null, tasks: 1 },
    ],
    byLabel: [
      { label: 'ui', tasks: 2 },
      { label: null, tasks: 1 },
    ],
  },
}

async function openPage(
  page: Page,
  size: (typeof SIZES)[number],
  answer: (query: URLSearchParams) => object,
  state: Record<string, string> = {},
) {
  const asked: URLSearchParams[] = []
  await installBackend(page)
  // Routed after the backend's own, so this one answers the read.
  await page.route('**/api/planning/volumes?*', (route) => {
    const query = new URL(route.request().url()).searchParams
    asked.push(query)
    return route.fulfill({ json: answer(query) })
  })
  await page.setViewportSize({ width: size.width, height: size.height })
  await page.goto(pageAt(state))
  await expect(page.locator('.volumes-page')).toBeVisible()
  return asked
}

async function shoot(page: Page, info: TestInfo, name: string) {
  await page.screenshot({ path: info.outputPath(`${name}.png`), animations: 'disabled' })
}

/** The tops of the numbers, each rounded to a pixel, in the order they stand. */
const numberTops = (page: Page) =>
  page
    .locator('[data-number]')
    .evaluateAll((numbers) => numbers.map((one) => Math.round(one.getBoundingClientRect().top)))

/** How far the panel's content runs past its width: above zero the page scrolls sideways. */
const overflow = (page: Page) =>
  page.locator('.volumes-panel').evaluate((panel) => panel.scrollWidth - panel.clientWidth)

for (const size of SIZES) {
  const words = WORDS[size.lang]
  const tag = `${size.lang} ${size.width}`
  const phone = size.width < 600

  test.describe(`Volumes, ${size.lang} at ${size.width}px`, () => {
    test.use({ locale: size.lang === 'ru' ? 'ru-RU' : 'en-US' })

    test('a goal’s volume and what it has left are read on its row', async ({ page }, info) => {
      await openPage(page, size, () => volumesAnswer({ ...READY, goals: goals() }))
      const numbers = page.locator('[data-number]')
      await expect(numbers).toHaveCount(10)
      const tops = await numberTops(page)
      // Ten numbers in one row, or two rows of five on a phone.
      expect(new Set(tops).size, JSON.stringify(tops)).toBe(phone ? 2 : 1)
      expect(tops.filter((top) => top === tops[0])).toHaveLength(phone ? 5 : 10)

      // No word of a number is cut or broken: where five have no room, the row scrolls instead.
      const parts = await shortfalls(page, '[data-number] [data-part]')
      expect(parts).toHaveLength(30)
      expect(parts.filter((part) => part.short > 0.5)).toEqual([])
      const row = page.locator('tr[data-reference="MAIN-10"]')
      await expect(row.locator('[data-figure="closed"]')).toHaveText(words.closed)
      await expect(row.locator('[data-figure="remaining"]')).toContainText(words.left)
      await expect(row.locator('[data-figure="remaining"]')).toContainText(words.basis)
      // The goal of five levels, each a level under the one over it.
      const levels = await page
        .locator('tr[data-reference^="MAIN-2"]')
        .evaluateAll((rows) => rows.map((one) => one.getAttribute('aria-level')))
      expect(levels).toEqual(['1', '2', '3', '4', '5'])
      // Its spending was not counted: «—» with the hint that says why, never 0.
      const spent = page.locator('tr[data-reference="MAIN-21"] [data-figure="spent"]')
      await expect(spent).toHaveText('—')
      await expect(spent).toHaveAttribute('aria-description', words.unknown)
      expect(await overflow(page)).toBeLessThanOrEqual(0)
      await shoot(page, info, `ready-${tag}`)
      await record(info, `volumes ready ${tag}`, { tops, overflow: await overflow(page) })
    })

    test('an open category’s number opens the board narrowed to it', async ({ page }, info) => {
      await openPage(page, size, () => volumesAnswer({ ...READY, goals: goals() }), { kind: 'bug' })
      await page.locator('[data-number="active"]').click()
      await expect.poll(() => parsePlatformRoute(new URL(page.url())).module_id).toBe('planning')
      const opened = parsePlatformRoute(new URL(page.url()))
      expect(opened.state).toMatchObject({ cat: 'active', kind: 'bug' })
      expect(opened.scope).toEqual(spaceScope)
      await shoot(page, info, `board-${tag}`)
    })

    test('a space without goals says so and counts its work outside goals', async ({
      page,
    }, info) => {
      await openPage(page, size, () => volumesAnswer(READY))
      await expect(page.getByText(words.noGoals)).toBeVisible()
      await expect(page.locator('tr[data-reference]')).toHaveCount(0)
      await expect(page.getByText(words.outside)).toBeVisible()
      await expect(page.locator('tr[data-row="alpha"] [data-category="ready"]')).toHaveText('2')
      expect(await overflow(page)).toBeLessThanOrEqual(0)
      await shoot(page, info, `no-goals-${tag}`)
    })

    test('a refresh that fails keeps what was shown and says so', async ({ page }, info) => {
      await openPage(page, size, () => volumesAnswer({ ...READY, goals: goals() }))
      await expect(page.locator('[data-number]')).toHaveCount(10)
      await page.route('**/api/planning/volumes?*', (route) =>
        route.fulfill({ status: 503, json: { error: { code: 'unavailable', message: 'busy' } } }),
      )
      await page.locator('.volumes-refresh').click()
      await expect(page.getByText(words.refreshFailed)).toBeVisible()
      await expect(page.locator('[data-number]')).toHaveCount(10)
      await shoot(page, info, `refresh-failed-${tag}`)
    })

    test('a scope with no work says so in the page’s words', async ({ page }, info) => {
      await openPage(page, size, () => volumesAnswer())
      await expect(page.getByText(words.empty)).toBeVisible()
      await expect(page.locator('[data-number]')).toHaveCount(0)
      await shoot(page, info, `empty-${tag}`)
    })

    test('a long tree’s frame is held to the panel, the panel scrolling to it', async ({
      page,
    }, info) => {
      const many = Array.from({ length: 40 }, (_, index) =>
        goalRow({ reference: `MAIN-${100 + index}`, total: 3, closed: 1 }),
      )
      await openPage(page, size, () => volumesAnswer({ ...READY, goals: many }))
      const frame = page.locator('.volumes-goals [data-region="table-frame"]')
      await frame.scrollIntoViewIfNeeded()
      const measured = await page.evaluate(() => {
        const panel = document.querySelector('.volumes-panel')?.getBoundingClientRect()
        const held = document
          .querySelector('.volumes-goals [data-region="table-frame"]')
          ?.getBoundingClientRect()
        return { panel: panel?.height ?? 0, frame: held?.height ?? 0 }
      })
      expect(measured.frame).toBeGreaterThan(0)
      expect(measured.frame, JSON.stringify(measured)).toBeLessThanOrEqual(measured.panel)
      await record(info, `volumes long ${tag}`, measured)
    })
  })
}
