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
import { enableExecutionTab } from './executionFixtures.ts'
import { frames } from './frames.ts'
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

/** Each element's box: its left edge and its width. */
function boxes(locator: Locator) {
  return locator.evaluateAll((nodes) =>
    nodes.map((node) => {
      const box = node.getBoundingClientRect()
      return { left: box.left, width: box.width }
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
  // Reduced, the slide still takes a frame, and on a loaded machine the first read lands in it.
  await expect(page.locator('.drawer')).toHaveCSS('transform', 'none')
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

/** The card's chain as a card opens it: Done folded. */
async function openChain(page: Page, width: number) {
  await openCard(page, width, {}, () => serve(page, chainOf(ROOT, members)))
  const list = page.locator('.drawer section.chain .chain-members')
  await expect(list.locator('.chain-row')).toHaveCount(8 + 2)
  return list
}

/**
 * Every heading's marks on the edge the rows start at, the folded Done among them: each group's
 * dot and the Done chevron drawn where they stand, each slot on the edge, and every name after
 * them at one edge. The chevron is a different glyph folded and open, so both states are read.
 */
async function expectHeadingsOnEdge(list: Locator, edge: number) {
  const headings = list.locator('.chain-group-title, .chain-done-toggle')
  await expect(headings).toHaveCount(4)
  // Done's slot is its toggle's box, whose start its chevron's square shares.
  const slots = await boxes(list.locator('.chain-group-title > :first-child, .chain-done-toggle'))
  expect(slots).toHaveLength(4)
  expectOneEdge(
    slots.map((slot) => slot.left),
    edge,
  )
  // The visible marks, not their slots: a dot drawn inside a larger slot, or a chevron's icon
  // with padding, starts further in than the slot does.
  const dots = await boxes(list.locator('.chain-group-title .state-dot'))
  const [chevron] = await boxes(list.locator('.chain-done-toggle svg path'))
  expect(dots).toHaveLength(3)
  expect(chevron).toBeDefined()
  expectOneEdge(
    dots.map((dot) => dot.left),
    edge,
  )
  expectOneEdge([chevron?.left ?? Number.NaN], edge)
  expect(spread(await wordsLeft(headings))).toBeLessThanOrEqual(ONE_EDGE)
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

    // Folded, as a card opens: the heads, Done's chevron in its folded glyph.
    await expectHeadingsOnEdge(list, edge)

    // Open: Done's rows join the list and its chevron takes the open glyph.
    await list.locator('.chain-done-toggle').click()
    await expect(list.locator('.chain-row')).toHaveCount(8 + 2 + 2)

    // Every row's words on the column's edge, its fill reaching outside it and not cut.
    const rows = list.locator('.chain-row')
    expectOneEdge(await wordsLeft(rows), edge)
    for (const fill of await boxes(rows)) {
      expect(fill.left).toBeLessThan(edge)
      expect(fill.left).toBeGreaterThanOrEqual(scrollerLeft)
    }
    await expectHeadingsOnEdge(list, edge)

    // The way to the rest of a long group reads as the list's own end.
    expectOneEdge(await wordsLeft(list.locator('.chain-more')), edge)
  })
}

/**
 * Where the toggle's chevron is drawn, held to `edge`, and where its words start, read once a
 * frame is drawn: Chromium answers a path's old box for the frame its `d` changed in.
 */
async function chevronOn(toggle: Locator, edge: number, what: string): Promise<number> {
  await frames(toggle)
  const [chevron] = await boxes(toggle.locator('svg path'))
  const left = chevron?.left ?? Number.NaN
  // Soft, so that one run names every disclosure standing off its edge, in either state.
  expect
    .soft(Math.abs(left - edge), `${what}: ${left} against ${edge}`)
    .toBeLessThanOrEqual(ONE_EDGE)
  const [words] = await wordsLeft(toggle)
  return words ?? Number.NaN
}

/**
 * A disclosure folded and then open: its chevron drawn on `edge` in both of its glyphs, and its
 * words where they were. The set draws a chevron inside a square whose side bearings differ by
 * direction, so a toggle that put the square on the edge stood its folded chevron 6px in and
 * its open one 4px in.
 */
async function expectFoldOnEdge(toggle: Locator, edge: number, what: string) {
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  const folded = await chevronOn(toggle, edge, `${what}, folded`)
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  const open = await chevronOn(toggle, edge, `${what}, open`)
  expect
    .soft(Math.abs(open - folded), `${what}: its words moved, ${folded} to ${open}`)
    .toBeLessThanOrEqual(ONE_EDGE)
}

for (const width of [1280, 390]) {
  test(`a chain's disclosures draw their chevrons on its heading's edge at ${width}px`, async ({
    page,
  }) => {
    const list = await openChain(page, width)
    const section = page.locator('.drawer section.chain')
    const [edge] = await wordsLeft(section.locator('.section-header-title'))
    await expect(section.locator('.chain-details-toggle')).toBeVisible()
    // «Chart and pace» over the list and «Done» in it, one under the other.
    await expectFoldOnEdge(section.locator('.chain-details-toggle'), edge ?? Number.NaN, 'chart')
    await expectFoldOnEdge(list.locator('.chain-done-toggle'), edge ?? Number.NaN, 'done')
  })
}

const report = { done: LONG, next: '' }

for (const width of [1280, 390]) {
  test(`a card's disclosures draw their chevrons on their column's edge at ${width}px`, async ({
    page,
  }) => {
    await enableExecutionTab(page)
    await openCard(page, width, { card: (read) => ({ ...read, summary: report }) })
    const drawer = page.locator('.drawer')

    // The outcome's name is its toggle; the preview's label starts its column.
    const outcome = drawer.locator('.outcome')
    const [label] = await wordsLeft(outcome.locator('.outcome-preview-label'))
    await expectFoldOnEdge(outcome.getByRole('button').first(), label ?? Number.NaN, 'outcome')

    // An attempt's details under its facts.
    await drawer.getByRole('tab', { name: /Execution/u }).click()
    const attempt = drawer.locator('.attempt').first()
    const [fact] = await wordsLeft(attempt.locator('.fact-name').first())
    const detail = attempt.locator('.attempt-context').getByRole('button')
    await expectFoldOnEdge(detail, fact ?? Number.NaN, 'attempt')

    // Memory's technical details under the line that names its source, once it has searched.
    await drawer.getByRole('tab', { name: /Memory/u }).click()
    const form = drawer.locator('.memory-form')
    await form.getByRole('textbox').fill('store')
    await form.getByRole('button').click()
    const technical = drawer.locator('.memory .disclosure').getByRole('button')
    await expect(technical).toBeVisible()
    const [source] = await wordsLeft(drawer.locator('.memory p.quiet').first())
    await expectFoldOnEdge(technical, source ?? Number.NaN, 'memory')
  })
}

/** Whether a toggle's chevron is drawn inside what answers a press and inside its focus ring. */
function pressOf(node: Element) {
  const chevron = node.querySelector('svg path')?.getBoundingClientRect()
  if (!chevron) return null
  const box = node.getBoundingClientRect()
  const style = getComputedStyle(node)
  const ring = Number.parseFloat(style.outlineOffset) + Number.parseFloat(style.outlineWidth)
  const hit = document.elementFromPoint(chevron.left + 0.5, chevron.top + chevron.height / 2)
  return {
    focused: node.matches(':focus-visible'),
    pressable: hit !== null && node.contains(hit),
    ringed:
      box.left - ring <= chevron.left &&
      chevron.right <= box.right + ring &&
      box.top - ring <= chevron.top &&
      chevron.bottom <= box.bottom + ring,
  }
}

const INSIDE = { focused: true, pressable: true, ringed: true }

/**
 * A chevron standing outside its press would be a mark nothing answers and a ring that cuts
 * it, and one in its own muted ink would vanish from a forced palette, which clears that ink.
 */
test("a chain's chevrons stay inside their press, its ring and the palette's ink", async ({
  page,
}) => {
  const list = await openChain(page, 1280)
  const section = page.locator('.drawer section.chain')
  const [edge] = await wordsLeft(section.locator('.section-header-title'))
  for (const toggle of [
    section.locator('.chain-details-toggle'),
    list.locator('.chain-done-toggle'),
  ]) {
    // Keyboard focus, with no pointer press before it, then open from the keyboard.
    await toggle.focus()
    expect(await toggle.evaluate(pressOf)).toEqual(INSIDE)
    await page.keyboard.press('Enter')
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await chevronOn(toggle, edge ?? Number.NaN, 'pressed open')
    expect(await toggle.evaluate(pressOf)).toEqual(INSIDE)
    // The palette's own colours, read under it: outside it they name other values.
    await page.emulateMedia({ forcedColors: 'active' })
    const system = await page.evaluate(() =>
      ['CanvasText', 'ButtonText', 'LinkText'].map((name) => {
        const probe = document.body.appendChild(document.createElement('span'))
        probe.style.cssText = `color: ${name}; forced-color-adjust: none`
        const value = getComputedStyle(probe).color
        probe.remove()
        return value
      }),
    )
    const ink = await toggle.locator('svg').evaluate((svg) => getComputedStyle(svg).color)
    expect(system).toContain(ink)
    await page.emulateMedia({ forcedColors: 'none' })
  }
})

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
