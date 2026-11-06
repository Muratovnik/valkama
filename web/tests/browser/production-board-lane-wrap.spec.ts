/**
 * A lane's heading that wraps starts its next row where its words start: under the epic's
 * number, or under the title of the lane with no epic, and never under the chevron or at
 * the heading's own edge, where the counts once stood 4px left of the chevron and 28px left
 * of the number they count for.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { installBackend } from './backend.ts'
import { boardSpace } from './boardFixtures.ts'
import { openBoard, serve, shot } from './boardPage.ts'
import { planningReadFor } from './planningReadFixture.ts'
import { test } from './test.ts'

/** The board's own space, read through `wideSpace`, over what `serve` answers. */
async function serveWide(page: Page) {
  await page.route('**/api/planning?*', async (route) => {
    const response = planningReadFor(new URL(route.request().url()).searchParams)
    const model = response.body as unknown as Model
    await route.fulfill({
      status: response.status,
      contentType: 'application/json',
      body: JSON.stringify(
        response.status === 200 && 'work_items' in model
          ? wideSpace({ ...model, work_items: [...model.work_items, ...boardSpace()] })
          : model,
      ),
    })
  })
}

type Model = Record<string, unknown> & {
  work_items: Record<string, unknown>[]
  workflow: { states: Record<string, unknown>[] }
}

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

/**
 * The board's space with a workflow wider than a desktop's board, and epics with work in
 * the last state, out of sight to the right: the headings that once wrapped their hidden
 * actions, or their note of that work beside a title shown whole, onto a row of its own.
 */
function wideSpace(model: Model): Model {
  const [backlog, dev, done] = model.workflow.states
  const between = ['Review', 'Testing', 'Staging', 'Blocked'].map((name, index) => ({
    ...dev,
    state_id: id(950 + index),
    key: name.toLowerCase(),
    name,
  }))
  const states = [backlog, dev, ...between, done].map((state, position) => ({
    ...state,
    position,
  }))
  // An item names its state without the workflow's ordering.
  const blocked = Object.fromEntries(
    Object.entries(states.at(-2) ?? {}).filter(([key]) => key !== 'position'),
  )
  const [template] = model.work_items
  // One title that fits beside its counts and its note of work out of sight, and one
  // that fits only when it gives way, each with work in the last state.
  const titles = [
    'Lane heads keep their counts beside a title shown whole, at every width',
    'Lane heads that shorten a long title before they move its counts and their note of work off the line',
  ]
  const added = titles.flatMap((title, index) => [
    {
      ...template,
      work_item_id: id(491 + 2 * index),
      reference: `MAIN-${491 + 2 * index}`,
      number: 491 + 2 * index,
      title,
      kind: 'epic',
      container: true,
      parent_id: null,
    },
    {
      ...template,
      work_item_id: id(492 + 2 * index),
      reference: `MAIN-${492 + 2 * index}`,
      number: 492 + 2 * index,
      title: 'Work waiting at the far end of the board',
      state: blocked,
      parent_id: id(491 + 2 * index),
    },
  ])
  return {
    ...model,
    workflow: { ...model.workflow, states },
    work_items: [...model.work_items, ...added],
  }
}

interface Row {
  left: number
  parts: string[]
}

interface Heading {
  rows: Row[]
  words: number
}

test('a lane heading that wraps at 390px starts its next row under its words', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 900 })
  await installBackend(page)
  await serve(page)
  await openBoard(page)
  await page.mouse.move(0, 0)

  const headings = await page.locator('.lane-head').evaluateAll((heads) =>
    heads.map((head) => {
      const words = head.querySelector('.lane-reference') ?? head.querySelector('.lane-title')
      // Every part the heading lays out in its rows; one it takes out of them to lie over
      // the last row, or that is only for a screen reader, starts no row. Parts of one row
      // are centred on it, so their tops differ: a part below everything before it is a row.
      const parts = [...head.children]
        .filter(
          (part) =>
            getComputedStyle(part).position !== 'absolute' &&
            part.getBoundingClientRect().width > 1,
        )
        .map((part) => ({ box: part.getBoundingClientRect(), name: String(part.className) }))
        .toSorted((one, two) => one.box.top - two.box.top)
      const rows: (Row & { bottom: number })[] = []
      for (const { box, name } of parts) {
        const last = rows.at(-1)
        if (last && box.top < last.bottom - 1) {
          last.left = Math.min(last.left, box.left)
          last.bottom = Math.max(last.bottom, box.bottom)
          last.parts.push(name)
        } else rows.push({ bottom: box.bottom, left: box.left, parts: [name] })
      }
      return {
        rows: rows.map(({ left, parts: names }) => ({ left, parts: names })),
        words: words?.getBoundingClientRect().left ?? Number.NaN,
      } satisfies Heading
    }),
  )

  const wrapped = headings.filter((heading) => heading.rows.length > 1)
  // An epic's lane, an empty one and a closed one each wrap here; a heading on one row
  // proves nothing about where a second one starts.
  expect(wrapped.length, 'lane headings that wrap').toBeGreaterThanOrEqual(3)
  for (const [index, heading] of wrapped.entries()) {
    const [first, ...below] = heading.rows
    expect(first?.parts[0], `heading ${index} leads with its toggle`).toContain('lane-toggle')
    for (const row of below)
      expect(
        Math.abs(row.left - heading.words),
        `heading ${index}: ${row.parts.join(' + ')} starts ${Math.round(row.left - heading.words)}px from its words`,
      ).toBeLessThanOrEqual(1)
  }
  await page.screenshot(shot(info, 'lane-wrap-390.png'))
})

interface Head {
  actions: { right: number; shown: boolean } | null
  bottom: number
  clipped: boolean
  drawnBottom: number
  elsewhere: boolean
  right: number
  rows: string[][]
}

/** Every heading's rows of drawn parts, how far its box runs past them, and its actions. */
const readHeads = (heads: Element[]) =>
  heads.map((head) => {
    const box = head.getBoundingClientRect()
    const title = head.querySelector('.lane-title')
    // A part is drawn when it has a size and is not see-through; one lying over the
    // heading rather than in its rows starts no row.
    const drawn = [...head.children].filter(
      (part) =>
        part.getBoundingClientRect().width > 1 && Number(getComputedStyle(part).opacity) > 0,
    )
    const rows: { bottom: number; parts: string[] }[] = []
    for (const part of drawn
      .filter((one) => getComputedStyle(one).position !== 'absolute')
      .toSorted((one, two) => one.getBoundingClientRect().top - two.getBoundingClientRect().top)) {
      const edge = part.getBoundingClientRect()
      const name = String(part.className).split(' ')[0] ?? ''
      const last = rows.at(-1)
      if (last && edge.top < last.bottom - 1) {
        last.bottom = Math.max(last.bottom, edge.bottom)
        last.parts.push(name)
      } else rows.push({ bottom: edge.bottom, parts: [name] })
    }
    const actions = head.querySelector('.lane-actions')
    return {
      actions: actions && {
        right: actions.getBoundingClientRect().right,
        shown: Number(getComputedStyle(actions).opacity) > 0,
      },
      bottom: box.bottom,
      clipped: Boolean(title && title.scrollWidth > title.clientWidth),
      drawnBottom: Math.max(...drawn.map((part) => part.getBoundingClientRect().bottom)),
      elsewhere: head.querySelector('.lane-elsewhere') !== null,
      right: box.right,
      rows: rows.map(({ parts }) => parts),
    } satisfies Head
  })

test('at 1280px a lane heading wraps only for want of room and keeps no blank row', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  // The actions fade in; with less motion asked for they are up as soon as hovered.
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await installBackend(page)
  await serve(page)
  await serveWide(page)
  await openBoard(page)
  await page.mouse.move(0, 0)

  const heads = await page.locator('.lane-head').evaluateAll(readHeads)
  // The states run past the board's width here, so headings name work out of sight.
  expect(heads.filter(({ elsewhere }) => elsewhere).length).toBeGreaterThanOrEqual(1)
  const counts = new Set(['lane-counts', 'lane-elsewhere'])
  for (const [index, head] of heads.entries()) {
    const said = `heading ${index}: ${JSON.stringify(head.rows)}`
    // The lane's actions, out of sight at rest, once wrapped onto a row that showed nothing.
    expect.soft(head.bottom - head.drawnBottom, `${said} keeps a blank band`).toBeLessThanOrEqual(1)
    // A title cut short is what lets the counts stay; only one shown whole may lack room.
    const alone = head.rows.slice(1).filter((row) => row.every((part) => counts.has(part)))
    expect
      .soft(
        head.clipped || alone.length === 0,
        `${said} puts its counts on a row of their own beside a title shown whole`,
      )
      .toBe(true)
  }

  // A pointer brings the actions up at the heading's end and moves nothing else.
  const first = page.locator('.lane-head').first()
  await first.hover()
  await expect(first.locator('.lane-actions')).toHaveCSS('opacity', '1')
  const [hovered] = await first.evaluateAll(readHeads)
  const [rest] = heads
  expect(hovered?.rows).toEqual(rest?.rows)
  expect(hovered?.bottom).toBe(rest?.bottom)
  expect(hovered?.actions?.shown).toBe(true)
  expect(Math.abs((hovered?.actions?.right ?? 0) - (hovered?.right ?? 0))).toBeLessThanOrEqual(1)
  await page.screenshot(shot(info, 'lane-heads-1280.png'))
})
