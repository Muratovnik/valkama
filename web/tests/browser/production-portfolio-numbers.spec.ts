/**
 * The four numbers of each space's card at «All spaces» in the real app, at 1280px and at 390px,
 * in English and in Russian. The oracle is the portfolio's contract in DESIGN.md
 * («Work», the context bar's «All spaces») and the directory's in the connection contract («A
 * space's card in the portfolio»): each card shows the cards in triage, the tasks ready and in
 * progress and the questions waiting for the owner; a space without numbers shows each as «—»
 * and says why; no word of a number is cut and nothing runs past the page's width. Each run
 * prints what it measured and keeps a picture.
 */
import { expect } from '@playwright/test'

import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { record, shortfalls } from './analyticsPage.ts'
import { installBackend } from './backend.ts'
import { dataScopeId, globalScope } from './planningFixtures.ts'
import { test } from './test.ts'

const SIZES = [
  { lang: 'en', width: 1280, height: 800, rows: 1 },
  { lang: 'en', width: 390, height: 844, rows: 3 },
  { lang: 'ru', width: 1280, height: 800, rows: 1 },
  { lang: 'ru', width: 390, height: 844, rows: 3 },
] as const

const WORDS = {
  en: {
    labels: ['Triage', 'Ready', 'In progress', 'Waiting for me'],
    oldStore: 'No data: an earlier build wrote this space’s store.',
    unreadable: 'The space could not be read.',
  },
  ru: {
    labels: ['Не разобрано', 'Готово к работе', 'В работе', 'Ждут меня'],
    oldStore: 'Нет данных: хранилище пространства записано прежней сборкой.',
    unreadable: 'Пространство не прочитано.',
  },
} as const

/** A space of the directory, as the server lists it. */
const space = (
  key: string,
  title: string,
  numbers: Record<string, number> | null,
  absent: string | null,
) => ({
  space_ref: { data_scope_id: dataScopeId, space_key: key },
  title,
  work_item_count: absent === 'unreadable' ? null : 412,
  numbers,
  numbers_absent: absent,
  default_project: null,
  projects: [{ project_id: 'alpha', display_name: 'Alpha' }],
})

const SPACES = [
  space('MAIN', 'Main work', { triage: 41, ready: 20, active: 5, waiting_owner: 12 }, null),
  space('OLD', 'Old store', null, 'old_store'),
  space('FAR', 'FAR', null, 'unreadable'),
]

for (const size of SIZES) {
  const words = WORDS[size.lang]
  const tag = `${size.lang} ${size.width}`

  test.describe(`«All spaces», ${size.lang} at ${size.width}px`, () => {
    test.use({ locale: size.lang === 'ru' ? 'ru-RU' : 'en-US' })

    test('each space’s card shows its four numbers, «—» where it has none', async ({
      page,
    }, info) => {
      await installBackend(page)
      // Routed after the backend's own, so this answers the directory.
      await page.route('**/api/platform/planning?*', (route) => {
        const query = new URL(route.request().url()).searchParams
        if (query.get('directory_only') !== 'true') return route.fallback()
        return route.fulfill({
          json: {
            interface_version: 'valkama-planning',
            scope: globalScope,
            state: {
              interface_version: 'valkama-ui-state',
              status: 'ready',
              payload: { spaces: SPACES, planning_spaces: [] },
            },
          },
        })
      })
      await page.setViewportSize({ width: size.width, height: size.height })
      await page.goto(serializePlatformRoute({ module_id: 'planning', scope: globalScope }))
      const cards = page.locator('.portfolio-space')
      await expect(cards).toHaveCount(3)

      const read = (index: number) =>
        cards
          .nth(index)
          .locator('[data-number]')
          .evaluateAll((numbers) =>
            numbers.map((one) => [
              one.querySelector<HTMLElement>('[data-part="label"]')?.textContent.trim(),
              one.querySelector<HTMLElement>('[data-part="figure"]')?.textContent.trim(),
            ]),
          )
      expect(await read(0)).toEqual(
        words.labels.map((label, index) => [label, ['41', '20', '5', '12'][index]]),
      )
      expect(await read(1)).toEqual(words.labels.map((label) => [label, '—']))
      expect(await read(2)).toEqual(words.labels.map((label) => [label, '—']))
      await expect(cards.nth(0).locator('[data-part="absent"]')).toHaveCount(0)
      await expect(cards.nth(1).locator('[data-part="absent"]')).toHaveText(words.oldStore)
      await expect(cards.nth(2).locator('[data-part="absent"]')).toHaveText(words.unreadable)

      // No word of a number is cut, and nothing runs past the page's width.
      const parts = await shortfalls(page, '.portfolio-space [data-number] [data-part]')
      expect(parts).toHaveLength(24)
      expect(parts.filter((part) => part.short > 0.5)).toEqual([])
      const sideways = await page.evaluate(() => {
        const frame = document.querySelector('[data-scroll-owner="planning-portfolio"]')
        return {
          page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          frame: frame ? frame.scrollWidth - frame.clientWidth : Number.NaN,
        }
      })
      expect(sideways.page, JSON.stringify(sideways)).toBeLessThanOrEqual(0)
      expect(sideways.frame, JSON.stringify(sideways)).toBeLessThanOrEqual(0)

      // Each card's «Open space» stands on its foot, so the cards of one row, whose words
      // differ in length, hold theirs on one line: after their own words they stood 78px apart.
      const feet = await cards.evaluateAll((all) =>
        all.map((card) => {
          const box = card.getBoundingClientRect()
          const button = card.querySelector('.open-space')?.getBoundingClientRect()
          return {
            row: Math.round(box.top),
            top: button?.top ?? Number.NaN,
            below: button ? box.bottom - button.bottom : Number.NaN,
          }
        }),
      )
      const rows = new Map<number, typeof feet>()
      for (const foot of feet) rows.set(foot.row, [...(rows.get(foot.row) ?? []), foot])
      for (const row of rows.values()) {
        const tops = row.map((foot) => foot.top)
        expect(Math.max(...tops) - Math.min(...tops), JSON.stringify(feet)).toBeLessThanOrEqual(0.5)
      }
      const below = feet.map((foot) => foot.below)
      expect(Math.max(...below) - Math.min(...below), JSON.stringify(feet)).toBeLessThanOrEqual(0.5)
      // Three cards stand in one row at 1280px, one to a row on a phone.
      expect(rows.size, JSON.stringify(feet)).toBe(size.rows)
      await page.screenshot({
        path: info.outputPath(`portfolio-${tag}.png`),
        animations: 'disabled',
        fullPage: true,
      })
      await record(info, `portfolio ${tag}`, { parts, sideways, feet })
    })
  })
}
