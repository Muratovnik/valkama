/**
 * What a goal spent, in the real app: on its row of the Work list grouped by goal and on its
 * card, at 1280px in English and at 390px in English and in Russian. The oracle is DESIGN.md
 * («Work», the list by goal, and the card's line of what work took): a goal's or a stage's row
 * says «Spent» and «With cancelled» under its title, read in one `goal-volumes` read for the
 * rows drawn and none for a task; a goal's card says the same two numbers under its line of
 * work, and its Agents tab the sessions and the weekly quota. Nothing runs past the page's
 * width and no figure is cut. Each run keeps a picture of each place.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { planningWorkItemEntity } from '@/shared/api/platformPlanningRefs.ts'
import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { richUsage, usageAnswer } from '../fixtures/usage.ts'
import { goalRow, goalVolumesAnswer, spentOf } from '../support/volumesDouble.ts'
import { record, shortfalls } from './analyticsPage.ts'
import { installBackend } from './backend.ts'
import { boardRoute } from './boardPage.ts'
import { brief, identity, serveSpace, stateOf, stillFrames } from './longSpace.ts'
import { spaceScope, workItemRef } from './planningFixtures.ts'
import { READ_DOWN_GOAL } from './served/cards.ts'
import { itemAnswer } from './servedAnswers.ts'
import { test } from './test.ts'

const SIZES = [
  { lang: 'en', width: 1280, height: 800 },
  { lang: 'en', width: 390, height: 844 },
  { lang: 'ru', width: 390, height: 844 },
] as const

const NB = '\u{A0}'
const WORDS = {
  en: {
    goal: [`Spent 2${NB}h · 30K`, `With cancelled 4${NB}h · 50K`],
    stage: [`Spent 1${NB}h · 10K`, `With cancelled 1${NB}h · 10K`],
    sessions: 'Sessions',
    quota: 'Weekly quota',
    percent: `≈${NB}10% of the week`,
  },
  ru: {
    goal: [`Потрачено 2${NB}ч · 30${NB}тыс.`, `С отменёнными 4${NB}ч · 50${NB}тыс.`],
    stage: [`Потрачено 1${NB}ч · 10${NB}тыс.`, `С отменёнными 1${NB}ч · 10${NB}тыс.`],
    sessions: 'Сессии',
    quota: 'Недельная квота',
    percent: `≈${NB}10${NB}% недели`,
  },
} as const

/** The goal, its stage and a task under each, each row of `goal-volumes` named by its item. */
const ITEMS = [
  brief(1, stateOf(1), { kind: 'goal', title: 'Launch' }),
  brief(2, stateOf(1), { kind: 'stage', title: 'Beta', parent_id: identity(1) }),
  brief(3, stateOf(1), { title: 'Write the notes', parent_id: identity(2) }),
  brief(4, stateOf(1), { title: 'Tidy up', parent_id: identity(1) }),
]
const GOAL = {
  ...goalRow({
    reference: 'MAIN-1',
    spent: spentOf(7200, 30_000),
    spentWithCancelled: spentOf(14_400, 50_000),
  }),
  work_item_id: identity(1),
}
const STAGE = {
  ...goalRow({
    reference: 'MAIN-2',
    kind: 'stage',
    parent: 'MAIN-1',
    spent: spentOf(3600, 10_000),
  }),
  work_item_id: identity(2),
}
const ROWS = new Map([
  [identity(1), GOAL],
  [identity(2), STAGE],
])

/** Answer `goal-volumes` for the ids asked, keeping each read's ids. */
async function serveGoalVolumes(page: Page) {
  const asked: string[][] = []
  await page.route('**/api/planning/goal-volumes?*', (route) => {
    const ids = new URL(route.request().url()).searchParams.getAll('id')
    asked.push(ids)
    // The card's goal reads as the list's goal does, by the card's own reference.
    const card = { ...GOAL, reference: workItemRef.reference }
    const rows = ids.map((id) => ROWS.get(id) ?? card)
    return route.fulfill({ json: goalVolumesAnswer(rows) })
  })
  return asked
}

/** What spans past the page's width, in pixels; zero or less when nothing does. */
const sideways = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)

for (const size of SIZES) {
  const words = WORDS[size.lang]
  const tag = `${size.lang} ${size.width}`

  test.describe(`What a goal spent, ${size.lang} at ${size.width}px`, () => {
    test.use({ locale: size.lang === 'ru' ? 'ru-RU' : 'en-US' })

    test('a goal’s and a stage’s rows of the list say both numbers', async ({ page }, info) => {
      await page.setViewportSize({ width: size.width, height: size.height })
      await installBackend(page)
      await serveSpace(page, ITEMS)
      const asked = await serveGoalVolumes(page)
      await page.goto(boardRoute({ view: 'list', group: 'goal', sort: 'reference' }))
      const row = (reference: string) =>
        page.locator(`.work-item-list tbody tr[data-reference="${reference}"]`)
      await expect(row('MAIN-1').locator('[data-spend]')).toHaveText([...words.goal])
      await expect(row('MAIN-2').locator('[data-spend]')).toHaveText([...words.stage])
      await expect(row('MAIN-3').locator('[data-spend]')).toHaveCount(0)
      await expect(row('MAIN-3')).toBeVisible()
      await stillFrames(page)
      // One read for the goal and the stage drawn, and none for a task.
      expect(asked).toEqual([[identity(1), identity(2)]])
      const parts = await shortfalls(page, '.work-item-list [data-spend]')
      expect(parts).toHaveLength(4)
      expect(parts.filter((part) => part.short > 0.5)).toEqual([])
      expect(await sideways(page)).toBeLessThanOrEqual(0)
      await page.screenshot({ path: info.outputPath(`list-${tag}.png`), animations: 'disabled' })
      await record(info, `goal spend list ${tag}`, { parts, asked })
    })

    test('a goal’s card says both numbers, its sessions and its quota', async ({ page }, info) => {
      await page.setViewportSize({ width: size.width, height: size.height })
      await installBackend(page)
      await page.route('**/api/modules/planning/work-item?*', (route) =>
        route.fulfill({ json: itemAnswer(spaceScope, workItemRef, READ_DOWN_GOAL) }),
      )
      const usage = richUsage({
        reference: workItemRef.reference,
        scope: 'tree',
        sessions: 3,
        quota: {
          weeks: [
            {
              account: { organization: 'org-alpha-0000', account_uuid: 'acct-beta-11111111' },
              seat: 'week:2030-03-11T09:00Z',
              week_ends_at: '2030-03-11T09:00:00Z',
              share: 0.25,
              week_used_percent: 40,
              percent: 10,
            },
          ],
          unknown_share: null,
        },
      })
      await page.route('**/api/planning/work-item/usage?*', (route) =>
        route.fulfill({ json: usageAnswer(usage) }),
      )
      const asked = await serveGoalVolumes(page)
      await page.goto(
        serializePlatformRoute({
          module_id: 'planning',
          scope: spaceScope,
          entity: planningWorkItemEntity(workItemRef),
        }),
      )
      const drawer = page.locator('.drawer')
      await expect(drawer.locator('[data-part="goal-spend"] [data-spend]')).toHaveText([
        ...words.goal,
      ])
      expect(asked).toEqual([[workItemRef.reference]])
      expect(await sideways(page)).toBeLessThanOrEqual(0)
      await page.screenshot({ path: info.outputPath(`card-${tag}.png`), animations: 'disabled' })

      await drawer.locator('.usage-line').click()
      await expect(drawer.getByText(words.quota, { exact: true })).toBeVisible()
      await expect(drawer.locator('[data-week] [data-part="percent"]')).toHaveText(words.percent)
      await expect(drawer.locator('.work-usage-figures')).toContainText(`${words.sessions} 3`)
      const parts = await shortfalls(page, '.drawer [data-week] > span')
      expect(parts).toHaveLength(3)
      expect(parts.filter((part) => part.short > 0.5)).toEqual([])
      expect(await sideways(page)).toBeLessThanOrEqual(0)
      await drawer.locator('[data-week]').scrollIntoViewIfNeeded()
      await page.screenshot({ path: info.outputPath(`agents-${tag}.png`), animations: 'disabled' })
      await record(info, `goal spend card ${tag}`, { parts, asked })
    })
  })
}
