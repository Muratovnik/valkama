/**
 * The board grouped by goal over goals and the stages under them, as a 3.0 read answers: an
 * accepted open goal or stage stands in no state and derives one from the work under it, and a
 * stage not yet accepted stands in triage. In the built application, in English and in Russian,
 * at a desk's width and a phone's.
 *
 * A lane is a goal's: the work under its stages, at any depth, stands in it, and a stage heads
 * no lane, so no item is drawn twice. The goal's lane head says the standing the server derived,
 * and that word lies inside its head, measured rather than looked at.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { installBackend } from './backend.ts'
import { BACKLOG, DEV } from './boardFixtures.ts'
import { boardRoute, lane, tiles } from './boardPage.ts'
import { identity, now, planningReadModel } from './planningFixtures.ts'
import { planningReadFor } from './planningReadFixture.ts'
import { test } from './test.ts'

const GOAL = 'Carry the board over to goals and stages'
const STAGE = 'Lanes by goal'
const NESTED = 'The stage under a stage'
const TRIAGE = 'A stage not accepted yet'

const DERIVED = { en: 'In progress', ru: 'В работе' } as const

/** A work item of the space, by its number, on the shared fixture's record. */
function brief(number: number, title: string, extra: Record<string, unknown>) {
  return {
    ...planningReadModel.work_items[1],
    work_item_id: identity(number),
    reference: `MAIN-${number}`,
    number,
    title,
    priority: 'medium',
    claim_ref: '',
    claim_state: null,
    parent_id: null,
    open: true,
    workable: false,
    revision: 1,
    ...extra,
  }
}

/** An accepted open goal or stage: no state, and what it derives from the work under it. */
const accepted = (number: number, title: string, kind: 'goal' | 'stage', extra = {}) =>
  brief(number, title, {
    kind,
    state: null,
    container_state: 'in_progress',
    acceptance: { basis: 'assignment', at: now },
    ...extra,
  })
const under = (parent: number) => ({ parent_id: identity(parent) })

const space = [
  accepted(501, GOAL, 'goal'),
  accepted(502, STAGE, 'stage', under(501)),
  brief(503, 'Stand the work under a stage in its goal’s lane', {
    kind: 'task',
    state: DEV,
    ...under(502),
  }),
  accepted(504, NESTED, 'stage', { ...under(502), container_state: 'not_started' }),
  brief(505, 'Work two stages down', { kind: 'task', state: BACKLOG, ...under(504) }),
  brief(506, TRIAGE, { kind: 'stage', state: BACKLOG, ...under(501) }),
  brief(507, 'Work under the stage not accepted', { kind: 'task', state: BACKLOG, ...under(506) }),
]

async function serve(page: Page, locale: 'en' | 'ru', width: number) {
  await page.setViewportSize({ width, height: 900 })
  await page.addInitScript((language) => localStorage.setItem('valkama-locale', language), locale)
  await installBackend(page)
  await page.route('**/api/planning?*', async (route) => {
    const response = planningReadFor(new URL(route.request().url()).searchParams)
    if (response.status === 200 && 'work_items' in response.body)
      response.body.work_items = [...response.body.work_items, ...(space as never[])]
    await route.fulfill({
      status: response.status,
      contentType: 'application/json',
      body: JSON.stringify(response.body),
    })
  })
}

for (const locale of ['en', 'ru'] as const)
  for (const width of [1280, 390])
    test(`a goal's lane holds the work under its stages, and no stage heads one (${locale}, ${width}px)`, async ({
      page,
    }) => {
      await serve(page, locale, width)
      await page.goto(boardRoute({ group: 'goal' }))
      const goal = lane(page, GOAL)
      await expect(goal).toBeVisible()
      await expect(goal.locator('[data-reference]').first()).toBeVisible()

      // No stage heads a lane, accepted or in triage.
      for (const stage of [STAGE, NESTED, TRIAGE]) await expect(lane(page, stage)).toHaveCount(0)
      // The work under the stages, at any depth, and the stage in triage, in the goal's lane.
      const inGoal = await tiles(goal)
      expect(inGoal.toSorted((a = '', b = '') => a.localeCompare(b))).toEqual([
        'MAIN-503',
        'MAIN-505',
        'MAIN-506',
        'MAIN-507',
      ])
      // Each drawn once on the whole board.
      const drawn = await tiles(page.locator('.work-item-board'))
      expect(drawn.filter((reference) => reference?.startsWith('MAIN-50'))).toHaveLength(4)
      expect(new Set(drawn).size).toBe(drawn.length)

      // The goal's head says the standing the server derived, inside the head.
      const head = goal.locator('.lane-head')
      const state = head.locator('.lane-state').filter({ visible: true })
      await expect(state).toHaveText(DERIVED[locale])
      const boxes = await head.evaluate((node) => {
        const word = [...node.querySelectorAll('.lane-state')].find(
          (part) => part.getBoundingClientRect().width > 0,
        )
        // eslint-disable-next-line unicorn/consistent-function-scoping -- serialized into the page
        const box = (part: Element | undefined) => {
          const { left, right, top, bottom } = part?.getBoundingClientRect() ?? new DOMRect()
          return { left, right, top, bottom }
        }
        return {
          head: box(node),
          state: box(word),
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        }
      })
      expect(boxes.state.left).toBeGreaterThanOrEqual(boxes.head.left)
      expect(boxes.state.right).toBeLessThanOrEqual(boxes.head.right)
      expect(boxes.state.top).toBeGreaterThanOrEqual(boxes.head.top)
      expect(boxes.state.bottom).toBeLessThanOrEqual(boxes.head.bottom)
      expect(boxes.overflow).toBe(0)
      test.info().annotations.push({ type: 'boxes', description: JSON.stringify(boxes) })
    })
