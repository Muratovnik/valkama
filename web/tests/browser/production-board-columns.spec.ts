/**
 * The board of the default workflow's eight states, as a 3.0 read answers it, in the built
 * application, in English and in Russian, at a desk's width and a phone's.
 *
 * «Deferred» starts folded to a strip with its count and opens on a press, which at a phone's
 * width leaves the board where it stood while a walk with the arrows takes it across; a goal or stage
 * stands as a tile only while it is not accepted, in «Triage» or «Deferred»; a tile that stands
 * ready and the queue would still not give is muted and says why with a sign and a word, the
 * whole sentence its name; a drag to another column moves the tile, a drop in its own moves
 * nothing; and by stage each part of a lane's path opens its own card.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { planningWorkItemRef } from '@/shared/api/platformPlanningRefs.ts'
import { parsePlatformRoute } from '@/shared/api/platformRoute.ts'

import { installBackend } from './backend.ts'
import { boardRoute, cell, drag, lane, shot, tiles } from './boardPage.ts'
import { identity, now, planningReadModel } from './planningFixtures.ts'
import { planningReadFor } from './planningReadFixture.ts'
import { test } from './test.ts'

/** The default workflow's eight states, in its order, as a 3.0 space declares them. */
const STATES = (
  [
    ['triage', 'Triage', 'triage', false],
    ['deferred', 'Deferred', 'deferred', false],
    ['ready', 'Ready', 'ready', false],
    ['dev', 'Dev', 'active', false],
    ['review', 'Review', 'review', false],
    ['done', 'Done', 'completed', true],
    ['blocked', 'Blocked', 'blocked', false],
    ['cancelled', 'Cancelled', 'cancelled', true],
  ] as const
).map(([key, name, category, terminal], position) => ({
  state_id: identity(950 + position),
  key,
  name,
  category,
  is_terminal: terminal,
  position,
}))
const workflow = {
  ...planningReadModel.workflow,
  initial_state_id: identity(950),
  states: STATES,
  transitions: STATES.flatMap((from) =>
    STATES.filter((to) => to !== from).map((to) => ({ from: from.state_id, to: to.state_id })),
  ),
}
const stateOf = (key: string) => {
  const { state_id, name, category, is_terminal } =
    STATES.find((entry) => entry.key === key) ?? STATES[0]
  return { state_id, key, name, category, is_terminal }
}

/** A work item of the space by its number, standing in `key`, or in none when accepted. */
function brief(number: number, title: string, key: string | null, extra: Record<string, unknown>) {
  const state = key === null ? null : stateOf(key)
  return {
    ...planningReadModel.work_items[1],
    work_item_id: identity(number),
    reference: `MAIN-${number}`,
    number,
    title,
    kind: 'task',
    priority: 'medium',
    claim_ref: '',
    claim_state: null,
    parent_id: null,
    state,
    open: state === null || !state.is_terminal,
    container_state: null,
    workable: false,
    withheld: ['not_ready'],
    waits_for: [],
    revision: 1,
    ...extra,
  }
}
const container = { kind: 'goal', withheld: ['goal_or_stage'] }
const accepted = { ...container, state: null, acceptance: { basis: 'owner', at: now } }
const under = (parent: number) => ({ parent_id: identity(parent) })
const ready = (withheld: string[]) => ({ workable: withheld.length === 0, withheld })

const GOAL = 'Carry the queue into the board'
const STAGE = 'Mute what the queue holds back'

const space = [
  brief(601, 'A goal nobody has accepted yet', 'triage', container),
  brief(602, 'A stage put off', 'deferred', { ...container, kind: 'stage', ...under(601) }),
  brief(603, GOAL, null, { ...accepted, container_state: 'in_progress' }),
  brief(604, STAGE, null, {
    ...accepted,
    kind: 'stage',
    container_state: 'in_progress',
    ...under(603),
  }),
  brief(605, 'A closed goal', 'done', { ...container, open: false, closed_at: now }),
  brief(606, 'Work the queue gives next', 'ready', { ...ready([]), ...under(604) }),
  brief(607, 'Work that waits for the owner’s answer', 'ready', ready(['question'])),
  brief(608, 'Work in a space handed out by hand', 'ready', ready(['queue_off'])),
  brief(609, 'Work a blocker holds', 'ready', { ...ready(['waits']), waits_for: ['MAIN-610'] }),
  brief(610, 'The blocker, at work', 'dev', { ...under(604), withheld: ['not_ready', 'held'] }),
  brief(611, 'Work put off', 'deferred', {}),
]
const links = [{ from: identity(610), to: identity(609), kind: 'blocks' }]

const WORDS = {
  en: {
    open: 'Open',
    unfold: 'Unfold Deferred',
    fold: 'Fold Deferred',
    question: 'awaits answer',
    byHand: 'by hand',
    questionWhole: 'The queue does not give it: it waits for the owner’s answer',
    byHandWhole: 'The queue does not give it: the owner hands out work in this space by hand',
  },
  ru: {
    open: 'Открыть',
    unfold: 'Раскрыть «Отложено»',
    fold: 'Свернуть «Отложено»',
    question: 'ждёт ответа',
    byHand: 'вручную',
    questionWhole: 'Очередь её не выдаёт: она ждёт ответа владельца',
    byHandWhole: 'Очередь её не выдаёт: владелец раздаёт работу в этом пространстве вручную',
  },
} as const

/** Moves the server was asked for, as `{reference, state}`. */
type Move = { reference: string; state: string }

async function serve(page: Page, locale: 'en' | 'ru', width: number): Promise<Move[]> {
  const moves: Move[] = []
  await page.setViewportSize({ width, height: 900 })
  await page.addInitScript((language) => localStorage.setItem('valkama-locale', language), locale)
  await installBackend(page)
  await page.route('**/api/planning?*', async (route) => {
    const response = planningReadFor(new URL(route.request().url()).searchParams)
    if (response.status === 200 && 'work_items' in response.body) {
      response.body.workflow = workflow as never
      response.body.work_items = space as never[]
      response.body.links = links as never[]
      response.body.stale_claims = []
    }
    await route.fulfill({
      status: response.status,
      contentType: 'application/json',
      body: JSON.stringify(response.body),
    })
  })
  await page.route('**/api/planning/work-item/transition', async (route) => {
    const body = route.request().postDataJSON() as { id: string; state: string }
    moves.push({ reference: body.id, state: body.state })
    await route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'workflow_guard', message: 'held for the test' } }),
    })
  })
  return moves
}

const board = (page: Page) => page.locator('.work-item-board')
const tile = (page: Page, reference: string) =>
  board(page).locator(`li[data-reference="${reference}"]`)
const openedCard = (page: Page) =>
  planningWorkItemRef(parsePlatformRoute(page.url()).entity)?.reference

for (const locale of ['en', 'ru'] as const)
  for (const width of [1280, 390]) {
    const words = WORDS[locale]

    test(`eight columns with Deferred folded to its count, opened and folded back by a press (${locale}, ${width}px)`, async ({
      page,
    }, info) => {
      await serve(page, locale, width)
      await page.goto(boardRoute())
      const strip = board(page).locator('.column-fold')
      await expect(strip).toHaveCount(1)
      await expect(board(page).locator('.work-item-column')).toHaveCount(7)
      const unfold = page.getByRole('button', { name: words.unfold, exact: true })
      await expect(unfold).toHaveAttribute('aria-expanded', 'false')
      await expect(strip).toContainText('2')
      // Folded, the strip is narrow, and nothing of what it holds is drawn.
      const narrow = await strip.evaluate((node) => node.getBoundingClientRect().width)
      expect(narrow).toBeLessThanOrEqual(48)
      await expect(tile(page, 'MAIN-611')).toHaveCount(0)
      await page.screenshot(shot(info, `kanban-${width}-deferred-folded-${locale}.png`))

      await unfold.click()
      await expect(board(page).locator('.work-item-column')).toHaveCount(8)
      await expect(board(page).locator('.column-fold')).toHaveCount(0)
      const column = board(page).locator('.work-item-column[data-state="deferred"]')
      await expect(column.locator('li[data-reference]')).toHaveCount(2)
      await column.scrollIntoViewIfNeeded()
      await page.screenshot(shot(info, `kanban-${width}-deferred-open-${locale}.png`))
      // The choice outlives a reload, and the same press on the open head folds it again.
      await page.reload()
      await expect(board(page).locator('.work-item-column')).toHaveCount(8)
      const fold = page.getByRole('button', { name: words.fold, exact: true })
      await expect(fold).toHaveAttribute('aria-expanded', 'true')
      await fold.click()
      await expect(board(page).locator('.column-fold')).toHaveCount(1)
      await expect(page.getByRole('button', { name: words.unfold, exact: true })).toBeFocused()
    })

    test(`a goal or stage stands as a tile only in Triage and Deferred (${locale}, ${width}px)`, async ({
      page,
    }) => {
      await serve(page, locale, width)
      await page.goto(boardRoute())
      await page.getByRole('button', { name: words.unfold, exact: true }).click()
      await expect(
        cell(board(page), 'triage').locator('li[data-reference="MAIN-601"]'),
      ).toHaveCount(1)
      await expect(
        cell(board(page), 'deferred').locator('li[data-reference="MAIN-602"]'),
      ).toHaveCount(1)
      // Accepted, open or closed, a goal or stage is in no column.
      const drawn = await tiles(board(page))
      for (const reference of ['MAIN-603', 'MAIN-604', 'MAIN-605'])
        expect(drawn).not.toContain(reference)
      expect(drawn).toContain('MAIN-606')
    })

    test(`a tile the queue would not give is muted and says why in a word (${locale}, ${width}px)`, async ({
      page,
    }, info) => {
      await serve(page, locale, width)
      await page.goto(boardRoute())
      const column = board(page).locator('.work-item-column[data-state="ready"]')
      await column.scrollIntoViewIfNeeded()
      const given = tile(page, 'MAIN-606')
      await expect(given.locator('.tile-exceptions')).toHaveCount(0)
      await expect(given.locator('.work-item-tile')).not.toHaveClass(/withheld/u)

      for (const [reference, word, whole] of [
        ['MAIN-607', words.question, words.questionWhole],
        ['MAIN-608', words.byHand, words.byHandWhole],
      ] as const) {
        const held = tile(page, reference)
        await expect(held.locator('.work-item-tile')).toHaveClass(/withheld/u)
        const exception = held.locator('.tile-exceptions')
        // The sign stands at the end of the first line, and the word beside it or, short of
        // room, in its name: the whole sentence is what the open target is described by.
        await expect(exception.locator('svg')).toHaveCount(1)
        await expect(exception.locator('.facet-word[aria-hidden="true"]')).toHaveText(word)
        await expect(held.locator('.tile-open')).toHaveAccessibleDescription(
          new RegExp(whole.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`), 'u'),
        )
        const boxes = await held.evaluate((node) => {
          const line = node.querySelector('.tile-line')?.getBoundingClientRect()
          const mark = node.querySelector('.tile-exceptions')?.getBoundingClientRect()
          return {
            line: line?.right ?? 0,
            mark: mark?.right ?? 0,
            top: line?.top,
            markTop: mark?.top,
          }
        })
        expect(boxes.mark).toBeLessThanOrEqual(boxes.line + 0.5)
        // Muted: the title takes the finished tile's ink, not the full one the given tile has.
        const ink = (where: typeof held) =>
          where.locator('.tile-open').evaluate((node) => getComputedStyle(node).color)
        expect(await ink(held)).not.toBe(await ink(given))
      }
      // A blocked tile names its blocker, and is muted too.
      const blocked = tile(page, 'MAIN-609')
      await expect(blocked.locator('.work-item-tile')).toHaveClass(/withheld/u)
      await expect(blocked.locator('.tile-exceptions')).toContainText('MAIN-610')
      // Work at work is not ready, which its column says: no word, no mute.
      const atWork = tile(page, 'MAIN-610')
      await expect(atWork.locator('.work-item-tile')).not.toHaveClass(/withheld/u)
      await expect(atWork.locator('.tile-exceptions')).toHaveCount(0)
      await page.screenshot(shot(info, `kanban-${width}-marks-muted-${locale}.png`))
    })

    test(`by stage, each part of a lane's path opens its own card (${locale}, ${width}px)`, async ({
      page,
    }, info) => {
      await serve(page, locale, width)
      await page.goto(boardRoute({ group: 'stage' }))
      const stageLane = lane(page, `${GOAL} › ${STAGE}`)
      await expect(stageLane).toBeVisible()
      const head = stageLane.locator('.lane-head')
      // The whole path is drawn on the heading's line, not clipped away beside the reference.
      const title = head.locator('.lane-title')
      expect(await title.evaluate((node) => node.getBoundingClientRect().width)).toBeGreaterThan(40)
      await stageLane.scrollIntoViewIfNeeded()
      await page.screenshot(shot(info, `kanban-${width}-by-stage-${locale}.png`))
      await head
        .getByRole('button', { name: `${words.open} MAIN-603 · ${GOAL}`, exact: true })
        .click()
      await expect.poll(() => openedCard(page)).toBe('MAIN-603')
      await page.goBack()
      await expect(page.locator('.drawer')).toBeHidden()
      await expect(stageLane).toBeVisible()
      await head
        .getByRole('button', { name: `${words.open} MAIN-604 · ${STAGE}`, exact: true })
        .click()
      await expect.poll(() => openedCard(page)).toBe('MAIN-604')
    })
  }

/**
 * Where the board stands across; whether each tile of `state` stands inside its box; and
 * whether the tile focus is in does.
 */
async function place(page: Page, state: string) {
  return board(page).evaluate((node, key) => {
    const box = node.getBoundingClientRect()
    const inside = (item: Element) => {
      const { left, right } = item.getBoundingClientRect()
      return left >= box.left - 1 && right <= box.right + 1
    }
    const focused = document.activeElement?.closest('li[data-reference]')
    return {
      across: Math.round(node.scrollLeft),
      shown: [...node.querySelectorAll(`ul[data-state="${key}"] li[data-reference]`)].map((item) =>
        inside(item),
      ),
      focused: focused ? inside(focused) : null,
    }
  }, state)
}

for (const locale of ['en', 'ru'] as const)
  test(`opening Deferred at 390px leaves the board where it stood, its tiles in sight (${locale})`, async ({
    page,
  }) => {
    await serve(page, locale, 390)
    await page.goto(boardRoute())
    await expect(board(page).locator('.column-fold')).toHaveCount(1)
    const before = await place(page, 'triage')
    expect(before.shown.length).toBeGreaterThan(0)
    expect(before).toEqual({ across: 0, shown: before.shown.map(() => true), focused: null })
    await page.getByRole('button', { name: WORDS[locale].unfold, exact: true }).click()
    // Focus goes to what folds it again, and the board does not slide to show it.
    await expect(page.getByRole('button', { name: WORDS[locale].fold, exact: true })).toBeFocused()
    await expect.poll(() => place(page, 'triage')).toEqual(before)
  })

// The control for the case above: a walk the reader makes does take the board across.
test('a walk across to a column past the edge of the board brings it in (390px)', async ({
  page,
}) => {
  await serve(page, 'en', 390)
  await page.goto(boardRoute())
  await tile(page, 'MAIN-601').getByRole('button').focus()
  const before = await place(page, 'ready')
  expect(before.shown.length).toBeGreaterThan(0)
  expect(before.shown).not.toContain(true)
  await page.keyboard.press('ArrowRight')
  await expect(cell(board(page), 'ready').locator('li[data-reference] :focus')).toHaveCount(1)
  const after = await place(page, 'ready')
  expect(after.across).toBeGreaterThan(0)
  expect(after.focused).toBe(true)
})

/** Drops a tile back on its own column, which asks the server for nothing. */
async function dropHome(page: Page, moves: Move[]) {
  await page.goto(boardRoute())
  const from = tile(page, 'MAIN-607')
  await from.scrollIntoViewIfNeeded()
  await drag(page, { from, to: cell(board(page), 'ready'), where: 'bottom', refused: true })
  await expect(board(page)).not.toHaveClass(/dragging/u)
  expect(moves).toEqual([])
  return from
}

test('a drag to another column asks for the move, a drop in its own asks nothing (1280px)', async ({
  page,
}) => {
  const moves = await serve(page, 'en', 1280)
  const from = await dropHome(page, moves)
  await drag(page, { from, to: cell(board(page), 'dev'), where: 'bottom' })
  await expect.poll(() => moves).toEqual([{ reference: 'MAIN-607', state: 'dev' }])
})

test('a drop in its own column asks nothing, and a phone shows one column at a time (390px)', async ({
  page,
}) => {
  const moves = await serve(page, 'en', 390)
  await dropHome(page, moves)
  // No second column stands on screen beside the tile's own to drop it on.
  const shown = await board(page).evaluate((node) => {
    const box = node.getBoundingClientRect()
    return [...node.querySelectorAll('.work-item-column')].filter((column) => {
      const { left, right } = column.getBoundingClientRect()
      return right > box.left + 1 && left < box.right - 1
    }).length
  })
  expect(shown).toBe(1)
})
