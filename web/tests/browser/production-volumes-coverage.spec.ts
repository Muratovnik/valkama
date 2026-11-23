/**
 * What the Volumes page says of what its read covers, in the real app against a double of the
 * server's read (`volumesDouble`), at 1280px and 390px in English and in Russian. The oracle is
 * DESIGN.md «Volumes»: a store the numbers could not read is said over them in the questions
 * window's words, and while an attached store holds work one line over the goals says the
 * sections count the main store's spaces alone, nearer the goals than the numbers. Each line
 * stands on the edges of the numbers and the goals, never past the panel and never cut; each run
 * prints what it measured and keeps a picture of both states.
 */
import { expect } from '@playwright/test'
import type { Locator, Page, TestInfo } from '@playwright/test'

import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { goalRow, volumesAnswer } from '../support/volumesDouble.ts'
import { record, shortfalls } from './analyticsPage.ts'
import { installBackend } from './backend.ts'
import { test } from './test.ts'

const WORDS = {
  en: {
    incomplete: 'Results are incomplete. Some sources are unavailable.',
    source: 'BETA: Store could not be opened',
    ownStore:
      'Goals, work outside goals, the flow and the estimates count the main store’s spaces only.',
    goals: 'Goals',
  },
  ru: {
    incomplete: 'Результаты неполные. Некоторые источники недоступны.',
    source: 'BETA: Хранилище не открылось',
    ownStore:
      'Цели, работа вне целей, поток и оценки считают только пространства основного хранилища.',
    goals: 'Цели',
  },
} as const

const SIZES = [
  { lang: 'en', width: 1280, height: 800 },
  { lang: 'en', width: 390, height: 844 },
  { lang: 'ru', width: 1280, height: 800 },
  { lang: 'ru', width: 390, height: 844 },
] as const

/** A store attached beside the main one, which the read could not open. */
const SKIPPED = [
  {
    space_ref: { data_scope_id: '00000000-0000-4000-8000-0000000000bb', space_key: 'BETA' },
    reason: 'store_unreadable',
  },
]

/** Every space's read: work in the main store, a goal, and what the case adds. */
const answer = (more: Parameters<typeof volumesAnswer>[0]) =>
  volumesAnswer({
    space: null,
    categories: { triage: 3, ready: 2, active: 1 },
    waiting: 1,
    goals: [goalRow({ reference: 'MAIN-10', title: 'Ship the volumes page', total: 3 })],
    ...more,
  })

async function openTop(page: Page, size: (typeof SIZES)[number], read: object) {
  await installBackend(page)
  // Routed after the backend's own, so this one answers the read.
  await page.route('**/api/planning/volumes?*', (route) => route.fulfill({ json: read }))
  await page.setViewportSize({ width: size.width, height: size.height })
  await page.goto(serializePlatformRoute({ module_id: 'volumes', scope: { kind: 'global' } }))
  await expect(page.locator('[data-number="triage"]')).toBeVisible()
}

type Box = { bottom: number; left: number; right: number; top: number }

/** A length to a tenth of a pixel. */
const round = (value: number) => Math.round(value * 10) / 10

async function box(locator: Locator): Promise<Box> {
  const found = await locator.boundingBox()
  if (!found) throw new Error('not drawn')
  return {
    left: round(found.x),
    right: round(found.x + found.width),
    top: round(found.y),
    bottom: round(found.y + found.height),
  }
}

/** How many lines a block of text takes: its height over its line's. */
const lines = (locator: Locator) =>
  locator.evaluate((element) => {
    const height = element.getBoundingClientRect().height
    return Math.round(height / Number.parseFloat(getComputedStyle(element).lineHeight))
  })

/** The numbers' list, its first number and its last, which the lines are held to. */
async function numbers(page: Page) {
  const all = page.locator('[data-number]')
  await expect(all).toHaveCount(10)
  return {
    first: await box(all.first()),
    last: await box(all.last()),
    // The right edge of the row: the rightmost number's, wherever the rows wrap.
    right: Math.max(
      ...(await all.evaluateAll((one) => one.map((n) => n.getBoundingClientRect().right))),
    ),
  }
}

/** How far the panel's content runs past its width: above zero the page scrolls sideways. */
const overflow = (page: Page) =>
  page.locator('.volumes-panel').evaluate((panel) => panel.scrollWidth - panel.clientWidth)

async function shoot(page: Page, info: TestInfo, name: string) {
  await page.screenshot({ path: info.outputPath(`${name}.png`), animations: 'disabled' })
}

for (const size of SIZES) {
  const words = WORDS[size.lang]
  const tag = `${size.lang} ${size.width}`

  test.describe(`Volumes coverage, ${size.lang} at ${size.width}px`, () => {
    test.use({ locale: size.lang === 'ru' ? 'ru-RU' : 'en-US' })

    test('a store the numbers could not read is said over them', async ({ page }, info) => {
      await openTop(page, size, answer({ skipped: SKIPPED }))
      const notes = page.locator('[data-coverage-note]')
      await expect(notes).toHaveCount(2)
      await expect(page.locator('[data-coverage-note="incomplete"]')).toHaveText(words.incomplete)
      await expect(page.locator('[data-coverage-note="source"]')).toHaveText(words.source)
      const held = await numbers(page)
      const incomplete = await box(page.locator('[data-coverage-note="incomplete"]'))
      const source = await box(page.locator('[data-coverage-note="source"]'))
      // Over the numbers, on their left edge, never past their right one.
      expect(source.bottom).toBeLessThanOrEqual(held.first.top)
      for (const line of [incomplete, source]) {
        expect(Math.abs(line.left - held.first.left)).toBeLessThanOrEqual(0.5)
        expect(line.right).toBeLessThanOrEqual(held.right + 0.5)
      }
      const cut = await shortfalls(page, '[data-coverage-note]')
      expect(cut).toHaveLength(2)
      expect(cut.filter((part) => part.short > 0.5)).toEqual([])
      expect(await overflow(page)).toBeLessThanOrEqual(0)
      await shoot(page, info, `coverage-${tag}`)
      await record(info, `volumes coverage ${tag}`, {
        incomplete,
        source,
        lines: [
          await lines(page.locator('[data-coverage-note="incomplete"]')),
          await lines(page.locator('[data-coverage-note="source"]')),
        ],
        numbers: held,
        gapToNumbers: round(held.first.top - source.bottom),
        overflow: await overflow(page),
      })
    })

    test('an attached store holding work is said over the goals', async ({ page }, info) => {
      await openTop(page, size, answer({ attachedWork: true }))
      const line = page.locator('[data-volumes-note="own-store"]')
      await expect(line).toHaveCount(1)
      await expect(line).toHaveText(words.ownStore)
      await expect(page.locator('[data-coverage-note]')).toHaveCount(0)
      const held = await numbers(page)
      const own = await box(line)
      const heading = await box(page.getByRole('heading', { name: words.goals, exact: true }))
      // Between the numbers and the goals, nearer the goals; on their left edge, never past
      // the numbers' right one.
      const above = round(own.top - held.last.bottom)
      const below = round(heading.top - own.bottom)
      expect(above).toBeGreaterThan(0)
      expect(below).toBeGreaterThanOrEqual(0)
      expect(below).toBeLessThan(above)
      expect(Math.abs(own.left - held.first.left)).toBeLessThanOrEqual(0.5)
      expect(Math.abs(own.left - heading.left)).toBeLessThanOrEqual(0.5)
      expect(own.right).toBeLessThanOrEqual(held.right + 0.5)
      expect(await overflow(page)).toBeLessThanOrEqual(0)
      await shoot(page, info, `own-store-${tag}`)
      await record(info, `volumes own store ${tag}`, {
        own,
        heading,
        numbers: held,
        above,
        below,
        lines: await lines(line),
        overflow: await overflow(page),
      })
    })

    test('with no attached store holding work the line is not there', async ({ page }) => {
      await openTop(page, size, answer({}))
      await expect(page.getByRole('heading', { name: words.goals, exact: true })).toBeVisible()
      await expect(page.locator('[data-volumes-note="own-store"]')).toHaveCount(0)
    })
  })
}
