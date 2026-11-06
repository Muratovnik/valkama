/**
 * The lists of a card, measured where they are drawn: what each block draws first stands on
 * the edge of the column it is in. A row whose fill keeps an inset under the pointer stands
 * that inset outside the column, so its words start where the heading over it does; a mark
 * in a target larger than itself stands on the edge and its target reaches outward.
 *
 * Each list here once drew three edges in one column: a chain's rows 8px inside their
 * headings, its group names at two more places after a dot and after a chevron; a session
 * in Relations 8px inside its label; a step's box 6px inside the checklist's heading.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { planningWorkItemEntity } from '@/shared/api/platformPlanningRefs.ts'
import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { chainOf, mapMember } from '../fixtures/chainMap.ts'
import { installBackend } from './backend.ts'
import { serve } from './chainFixtures.ts'
import { openPlanFor } from './openSessionFixtures.ts'
import { projectScope, workItem, workItemRef } from './planningFixtures.ts'
import { test } from './test.ts'

const CARD = serializePlatformRoute({
  module_id: 'planning',
  scope: projectScope,
  entity: planningWorkItemEntity(workItemRef),
})

/** Under a pixel: two edges a reader sees as one. */
const ONE_EDGE = 0.5

const ROOT = { id: workItem.work_item_id, reference: workItemRef.reference, title: workItem.title }
const LONG = 'Перенести проверку целостности хранилища в отдельный этап сборки и описать откат'

/** Where the first letters of each element's words are drawn. */
function wordsLeft(locator: Locator): Promise<number[]> {
  return locator.evaluateAll((nodes) =>
    nodes.map((node) => {
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT)
      let text = walker.nextNode()
      while (text && !text.textContent?.trim()) text = walker.nextNode()
      if (!text) return Number.NaN
      const range = document.createRange()
      range.selectNodeContents(text)
      return range.getClientRects()[0]?.left ?? Number.NaN
    }),
  )
}

/** Each element's box: its left edge and its centre. */
function boxes(locator: Locator) {
  return locator.evaluateAll((nodes) =>
    nodes.map((node) => {
      const box = node.getBoundingClientRect()
      return { left: box.left, centre: box.left + box.width / 2, width: box.width }
    }),
  )
}

function spread(values: number[]): number {
  return Math.max(...values) - Math.min(...values)
}

function expectOneEdge(values: number[], edge: number) {
  for (const value of values) expect(Math.abs(value - edge)).toBeLessThanOrEqual(ONE_EDGE)
}

/**
 * The card at a width, with motion reduced so the drawer stands still while it is measured:
 * it slides in otherwise, and two reads a frame apart see it in two places.
 */
async function openCard(
  page: Page,
  width: number,
  options: Parameters<typeof installBackend>[1] = {},
  /** Routes of the test's own, which answer before the backend's. */
  own: () => Promise<void> = async () => {},
) {
  await page.setViewportSize({ width, height: 1000 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await installBackend(page, options)
  await own()
  await page.goto(CARD)
}

/** Nine under way, so the group stops after a screenful and offers the rest. */
const members = [
  ...Array.from({ length: 9 }, (_, index) =>
    mapMember(`MAIN-${101 + index}`, 'active', workItemRef.reference, {
      title: `${LONG} ${index + 1}`,
    }),
  ),
  mapMember('MAIN-120', 'review', workItemRef.reference, { title: LONG }),
  mapMember('MAIN-121', 'blocked', workItemRef.reference, { title: LONG }),
  mapMember('MAIN-130', 'done', workItemRef.reference, { title: LONG }),
  mapMember('MAIN-131', 'done', workItemRef.reference, { title: LONG }),
]

async function openChain(page: Page, width: number) {
  await openCard(page, width, {}, () => serve(page, chainOf(ROOT, members)))
  const list = page.locator('.drawer section.chain .chain-members')
  await expect(list.locator('.chain-row')).toHaveCount(8 + 2)
  await list.locator('.chain-done-toggle').click()
  await expect(list.locator('.chain-row')).toHaveCount(8 + 2 + 2)
  return list
}

for (const width of [1280, 390]) {
  test(`a chain's rows and headings start at one edge at ${width}px`, async ({ page }) => {
    const list = await openChain(page, width)
    const [column] = await boxes(list)
    const edge = column?.left ?? Number.NaN
    // The card's scroller, which cuts whatever leaves it.
    const scrollerLeft = await list.evaluate((node) => {
      let up = node.parentElement
      while (up && getComputedStyle(up).overflowY === 'visible') up = up.parentElement
      return up?.getBoundingClientRect().left ?? 0
    })

    // Every row's words on the column's edge, its fill reaching outside it and not cut.
    const rows = list.locator('.chain-row')
    expectOneEdge(await wordsLeft(rows), edge)
    for (const fill of await boxes(rows)) {
      expect(fill.left).toBeLessThan(edge)
      expect(fill.left).toBeGreaterThanOrEqual(scrollerLeft)
    }

    // Every heading, the folded Done among them: its mark's slot on the edge, a dot and a
    // chevron on one centre, and every group's name at one edge after them.
    const headings = list.locator('.chain-group-title, .chain-done-toggle')
    await expect(headings).toHaveCount(4)
    const slots = await boxes(
      list.locator('.chain-group-title > :first-child, .chain-done-toggle > :first-child'),
    )
    expect(slots).toHaveLength(4)
    expectOneEdge(
      slots.map((slot) => slot.left),
      edge,
    )
    const marks = await boxes(list.locator('.chain-group-title .state-dot, .chain-done-toggle svg'))
    expect(spread(marks.map((mark) => mark.centre))).toBeLessThanOrEqual(ONE_EDGE)
    expect(spread(await wordsLeft(headings))).toBeLessThanOrEqual(ONE_EDGE)

    // The way to the rest of a long group reads as the list's own end.
    expectOneEdge(await wordsLeft(list.locator('.chain-more')), edge)
  })
}

const KNOWN = '6f1c2a8e-0000-4000-8000-000000000201'
const UNKNOWN = '6f1c2a8e-0000-4000-8000-000000000202'

/** One session a press can open and one nothing can, which stands as words. */
function plans(query: URLSearchParams): object {
  const answered = openPlanFor(query) as Record<string, unknown>
  return query.get('session') === UNKNOWN
    ? { ...answered, opens: null, steps: [{ kind: 'explain', reason: 'no-folder' }] }
    : answered
}

const withSessions = (read: Record<string, unknown>) => ({
  ...read,
  refs: [KNOWN, UNKNOWN].map((value, index) => ({
    kind: 'session',
    value,
    label: `${LONG} ${index + 1}`,
    author: 'the owner',
    at: '2026-08-13T08:00:00Z',
  })),
})

for (const width of [1280, 390]) {
  test(`a session in Relations starts where its label does at ${width}px`, async ({ page }) => {
    await openCard(page, width, { card: withSessions, openPlan: plans })
    await page.getByRole('tab', { name: /Relations|Связи/u }).click()
    const rows = page.locator('.ref-row').filter({ has: page.locator('.ref-session') })
    await expect(rows).toHaveCount(2)
    const pressable = rows.nth(0).locator('button.open-action')
    const still = rows.nth(1).locator('.open-action-still')
    await expect(pressable).toBeVisible()
    await expect(still).toBeVisible()
    const [first, second] = await wordsLeft(rows.locator('.ref-kind'))

    // Relations offers a session as a ghost, whose ground is painted at rest and so is what
    // it draws first: the ground starts at the label's edge.
    await expect(pressable).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
    const [ground] = await boxes(pressable)
    expectOneEdge([ground?.left ?? Number.NaN], first ?? Number.NaN)
    expectOneEdge(await wordsLeft(still), second ?? Number.NaN)
  })
}

const steps = [
  { id: '123e4567-e89b-42d3-a456-426614174201', text: LONG, done: true, done_by: 'agent' },
  { id: '123e4567-e89b-42d3-a456-426614174202', text: LONG, done: false, claimed_by: 'agent' },
  { id: '123e4567-e89b-42d3-a456-426614174203', text: 'Короткий шаг', done: false },
].map((step) => ({ claimed_by: '', done_by: '', ...step }))

for (const width of [1280, 390]) {
  test(`a step's box stands on the checklist's edge at ${width}px`, async ({ page }) => {
    await openCard(page, width, { card: (read) => ({ ...read, checklist: steps }) })
    await expect(page.locator('.step-row')).toHaveCount(steps.length)

    const [list] = await boxes(page.locator('.checklist'))
    const edge = list?.left
    const marks = await boxes(page.locator('.step-mark'))
    expect(marks).toHaveLength(steps.length)
    expectOneEdge(
      marks.map((mark) => mark.left),
      edge ?? Number.NaN,
    )
    // The box keeps its whole target: it reaches outward rather than shrinking.
    for (const target of await boxes(page.locator('.step'))) expect(target.width).toBe(28)
  })
}
