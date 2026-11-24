/**
 * The Analytics bar's chip while the name of the value it holds is read, on phones of 320 to 430px,
 * in Russian and in English, from a past period and from a live one, for a task, a project and a
 * session, the values only a read names (DESIGN.md, the Analytics bar: «a filter set has its
 * dimension's read to name its chip»).
 *
 * Before the first answer the chip says its dimension and never the value's id: it said «Задача:
 * 00000000-0…». Once named, a chip keeps its name while its dimension is read again for another
 * period, rather than its id until the new answer. A refresh that fails leaves the name as it was.
 *
 * On a phone one chip yields its room to «Clear filters» rather than send it to a line of its own:
 * the two stand on one line whatever name comes, a name with no room cut with its hint saying it
 * whole and a name that fits with no hint. So the bar keeps one height before the first answer,
 * once named, while another period is read and once it is: the room of the widest chip, which the
 * chip holds before the answer, sent «Снять фильтры» to a second line, 32px, at 380 to 401px in
 * Russian and 340 to 370px in English, and a short name then brought it back. Two chips keep their
 * words and wrap, as the row did before.
 *
 * A name with no room beside «Clear filters» shows its value's start without its dimension's
 * words, which stay in its hint: at 320px in Russian the words «Задача:», «Проект:» and
 * «Исполнитель:» took all the room and the value showed as its ellipsis alone. Whether they stand is the
 * whole name's width against the chip's room, so it holds in every state at a width; the chip
 * before the first answer keeps them. «Clear filters» stands against the bar's end, so the
 * name coming moves it not at all: it moved up to 63px at 430px.
 */
import { expect } from '@playwright/test'
import type { Page, Route } from '@playwright/test'

import { task } from '../fixtures/analytics.ts'
import { failRefresh, frames, serveFailing } from './analyticsBarFailure.ts'
import { pageAt, record } from './analyticsPage.ts'
import { hint, pass } from './hintFramesPage.ts'
import { PROJECT, SESSION } from './served/analyticsBarStates.ts'
import { test } from './test.ts'

const WIDTHS = [320, 340, 360, 370, 380, 384, 390, 399, 400, 401, 410, 430] as const

/**
 * The values a filter is set to, as the double names them (`served/analyticsBarStates.ts`): what
 * the chip says once named, and the id it never says.
 */
const VALUES = {
  task: { dimension: 'work_item', id: task(1, 'One').id ?? '', named: 'MAIN-1 One' },
  project: { dimension: 'project', id: PROJECT.id, named: PROJECT.name },
  session: { dimension: 'executor', id: SESSION.id, named: SESSION.title },
} as const

type Value = keyof typeof VALUES

const WORDS = {
  ru: {
    clear: 'Снять фильтры',
    dimensions: { task: 'Задача', project: 'Проект', session: 'Исполнитель' },
    today: 'Сегодня',
    week: 'Эта неделя',
  },
  en: {
    clear: 'Clear filters',
    dimensions: { task: 'Task', project: 'Project', session: 'Executor' },
    today: 'Today',
    week: 'This week',
  },
} as const

/** A past period and a live one, each with the one it switches to. */
const PERIODS = {
  week: { state: {}, next: 'today' },
  today: { state: { period: 'today' }, next: 'week' },
} as const

test.use({ locale: 'ru-RU', launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] } })

/**
 * Holds the usage reads `which` takes while `holding`, each until `release`; the double answers
 * the rest. Registered after the double's own routes, so it is asked first.
 */
async function holdReads(page: Page) {
  let which: ((query: URLSearchParams) => boolean) | null = null
  const held: Route[] = []
  await page.route('**/api/analytics/usage?*', async (route) => {
    const query = new URL(route.request().url()).searchParams
    if (which?.(query)) held.push(route)
    else await route.fallback()
  })
  return {
    held,
    hold: (reads: (query: URLSearchParams) => boolean) => {
      which = reads
    },
    async release() {
      which = null
      for (const route of held.splice(0)) await route.fallback()
    },
  }
}

/** A read of what a dimension's filter offers: by that dimension, and not itself filtered by it. */
const offering = (dimension: string) => (query: URLSearchParams) =>
  (query.get('group_by') ?? '').split(',').includes(dimension) && !query.has(dimension)

/**
 * The bar's height; each chip, what it says, its box, whether it shows less than it holds (a box
 * in it that hides what it holds across or down) and how much of its dimension's words (`lead`,
 * «Задача:») and of its value after them shows, in px, inside every box in it that cuts; the box
 * of «Clear filters», by its name; and the bar's end, the read again's right edge.
 */
const chipState = (page: Page, clear: string, lead: string) =>
  page.evaluate(
    ([name, words]) => {
      // This body is serialized and evaluated in the page, so a module-scope
      // helper would not be in scope here.
      // eslint-disable-next-line unicorn/consistent-function-scoping -- see above
      const rect = (found: Element | null | undefined) => {
        const box = found?.getBoundingClientRect()
        return box ? { left: box.left, top: box.top, right: box.right, bottom: box.bottom } : null
      }
      const bar = document.querySelector('.analytics-bar')
      const chips = [...(bar?.querySelectorAll('[data-filter-chip]') ?? [])]
      const button = [...(bar?.querySelectorAll('button') ?? [])].find(
        (one) => one.textContent?.trim() === name,
      )
      // eslint-disable-next-line unicorn/consistent-function-scoping -- see above
      const cuts = (box: Element) => {
        const style = getComputedStyle(box)
        return (
          (style.overflowX !== 'visible' && box.scrollWidth > box.clientWidth) ||
          (style.overflowY !== 'visible' && box.scrollHeight > box.clientHeight + 1)
        )
      }
      /** The px of a text node's characters `from` to `to` that show inside the boxes that cut it. */
      const shownOf = (chip: Element, node: Text, from: number, to: number) => {
        let clip = { left: -Infinity, right: Infinity, top: -Infinity, bottom: Infinity }
        for (let box = node.parentElement; box && box !== chip; box = box.parentElement) {
          const style = getComputedStyle(box)
          if (style.overflowX === 'visible' && style.overflowY === 'visible') continue
          const edges = box.getBoundingClientRect()
          clip = {
            left: Math.max(clip.left, edges.left),
            right: Math.min(clip.right, edges.right),
            top: Math.max(clip.top, edges.top),
            bottom: Math.min(clip.bottom, edges.bottom),
          }
        }
        const range = document.createRange()
        range.setStart(node, from)
        range.setEnd(node, to)
        let sum = 0
        for (const line of range.getClientRects()) {
          const down = Math.min(line.bottom, clip.bottom) - Math.max(line.top, clip.top)
          const across = Math.min(line.right, clip.right) - Math.max(line.left, clip.left)
          if (down >= line.height / 2) sum += Math.max(0, across)
        }
        return sum
      }
      /** How much of the chip's `words` and of its value after them and a space shows. */
      const wordsOf = (chip: Element) => {
        const shown = { lead: 0, value: 0 }
        const walker = document.createTreeWalker(chip, NodeFilter.SHOW_TEXT)
        let at = 0
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const text = node as Text
          const end = at + text.length
          const lead = [at, Math.min(end, words.length)] as const
          const value = [Math.max(at, words.length + 1), end] as const
          if (lead[0] < lead[1]) shown.lead += shownOf(chip, text, lead[0] - at, lead[1] - at)
          if (value[0] < value[1]) shown.value += shownOf(chip, text, value[0] - at, value[1] - at)
          at = end
        }
        return shown
      }
      return {
        window: document.documentElement.clientWidth,
        bar: bar?.getBoundingClientRect().height ?? 0,
        chips: chips.map((chip) => chip.textContent?.trim() ?? ''),
        boxes: chips.map((chip) => rect(chip)),
        cut: chips.map((chip) => [chip, ...chip.querySelectorAll('*')].some((box) => cuts(box))),
        words: chips.map((chip) => wordsOf(chip)),
        clear: rect(button),
        end: rect(bar?.querySelector('.analytics-refresh'))?.right ?? Number.NaN,
      }
    },
    [clear, lead] as const,
  )

type ChipState = Awaited<ReturnType<typeof chipState>>

/** The state at each of `widths`, the page settled after each resize. */
async function acrossWidths(
  page: Page,
  clear: string,
  lead: string,
  widths: readonly number[] = WIDTHS,
) {
  const seen: Record<number, ChipState> = {}
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 })
    await page.evaluate(() => document.fonts.ready)
    await frames(page)
    seen[width] = await chipState(page, clear, lead)
  }
  return seen
}

/** One chip, saying the dimension, and never the value's id. */
function expectNoId(name: string, seen: Record<number, ChipState>, dimension: string, id: string) {
  for (const [width, state] of Object.entries(seen)) {
    expect.soft(state.chips, `${name} at ${width}px: the chips`).toHaveLength(1)
    expect.soft(state.chips[0], `${name} at ${width}px: the chip's dimension`).toContain(dimension)
    expect.soft(state.chips[0], `${name} at ${width}px: the value's id`).not.toContain(id)
  }
}

/** The middle of a box, down. */
const middle = (box: { bottom: number; top: number }) => (box.top + box.bottom) / 2

/** One chip and «Clear filters» after it on one line, inside the window. */
function expectOneLine(name: string, seen: Record<number, ChipState>) {
  for (const [width, state] of Object.entries(seen)) {
    const chip = state.boxes[0] ?? { left: 0, top: 0, right: Number.NaN, bottom: 0 }
    const clear = state.clear ?? { left: Number.NaN, top: 0, right: Number.NaN, bottom: 0 }
    expect
      .soft(
        Math.abs(middle(clear) - middle(chip)),
        `${name} at ${width}px: «Clear filters» wrapped`,
      )
      .toBeLessThanOrEqual(1)
    expect
      .soft(clear.left, `${name} at ${width}px: «Clear filters» before the chip's end`)
      .toBeGreaterThanOrEqual(chip.right)
    expect
      .soft(clear.right, `${name} at ${width}px: «Clear filters» past the window`)
      .toBeLessThanOrEqual(state.window)
    expect
      .soft(Math.abs(clear.right - state.end), `${name} at ${width}px: «Clear filters» off the end`)
      .toBeLessThanOrEqual(1)
  }
}

/**
 * The named chip shows its value's start, and its dimension's words only where it is whole: cut,
 * they gave the value no room. Before the first answer the chip keeps them, as it always did.
 */
function expectNameFirst(name: string, seen: Record<number, ChipState>) {
  for (const [width, state] of Object.entries(seen)) {
    const words = state.words[0] ?? { lead: Number.NaN, value: Number.NaN }
    expect.soft(words.value, `${name} at ${width}px: the value's start`).toBeGreaterThan(0)
    if (state.cut[0])
      expect.soft(words.lead, `${name} at ${width}px: the dimension on the cut chip`).toBe(0)
    else
      expect
        .soft(words.lead, `${name} at ${width}px: the dimension on the whole chip`)
        .toBeGreaterThan(0)
  }
}

/** Before the first answer the chip says its dimension, whatever its room. */
function expectPlaceholder(seen: Record<number, ChipState>) {
  for (const [width, state] of Object.entries(seen))
    expect
      .soft(state.words[0]?.lead, `before the first answer at ${width}px: the dimension`)
      .toBeGreaterThan(0)
}

/** «Clear filters» stands where it stood before the first answer, in every state. */
function expectClearStill(states: Record<string, Record<number, ChipState>>) {
  const before = states.first ?? {}
  for (const [name, seen] of Object.entries(states))
    for (const [width, state] of Object.entries(seen))
      expect
        .soft(state.clear?.left, `${name} at ${width}px: «Clear filters» moved`)
        .toBeCloseTo(before[Number(width)]?.clear?.left ?? Number.NaN, 0)
}

/** Whether the chip's dimension shows in each state as it does once named, at each width. */
function expectSteadyLead(
  named: Record<number, ChipState>,
  rest: Record<string, Record<number, ChipState>>,
) {
  for (const [width, state] of Object.entries(named))
    for (const [name, seen] of Object.entries(rest))
      expect
        .soft(seen[Number(width)]?.words[0]?.lead === 0, `${name} at ${width}px: the dimension`)
        .toBe(state.words[0]?.lead === 0)
}

/**
 * At each width, the chip's hint while the pointer rests on it: its whole words where it is cut,
 * none where it is whole. Returns the widths it was cut at.
 */
async function expectHints(page: Page, name: string, seen: Record<number, ChipState>) {
  const cutAt: number[] = []
  const chip = page.locator('.analytics-bar [data-filter-chip]')
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 })
    await frames(page)
    const cut = seen[width]?.cut[0] ?? false
    if (cut) cutAt.push(width)
    await chip.hover()
    await pass(page, 1000)
    if (cut) await expect.soft(hint(page), `${width}px: the cut chip's hint`).toHaveText(name)
    else await expect.soft(hint(page), `${width}px: the whole chip's hint`).toHaveCount(0)
    await page.mouse.move(0, 0)
    await expect(hint(page)).toHaveCount(0)
  }
  return cutAt
}

/**
 * A session's name has no room beside «Clear filters» on the narrowest phone, and a task's has it
 * on the widest: both of the hint's cases are reached.
 */
function expectBothHints(kind: Value, cutAt: readonly number[]) {
  if (kind === 'session') expect.soft(cutAt, 'the session cut at 320px').toContain(320)
  if (kind === 'task') expect.soft(cutAt, 'the task cut at 430px').not.toContain(430)
}

for (const locale of ['ru', 'en'] as const)
  for (const [from, period] of Object.entries(PERIODS))
    for (const [kind, value] of Object.entries(VALUES) as [Value, (typeof VALUES)[Value]][])
      test(`one chip of a ${kind} keeps the bar's height while its name is read, from ${from} in ${locale}`, async ({
        page,
      }, info) => {
        const words = WORDS[locale]
        const dimension = words.dimensions[kind]
        const lead = `${dimension}:`
        await page.addInitScript((chosen) => localStorage.setItem('valkama-locale', chosen), locale)
        const fail = await serveFailing(page, WIDTHS[0])
        const reads = await holdReads(page)
        const chip = page.locator('.analytics-bar [data-filter-chip]')
        const filters = JSON.stringify({ [value.dimension]: [value.id] })

        // Before the first answer: every read held.
        reads.hold(() => true)
        await page.goto(pageAt({ ...period.state, filters }))
        await expect(chip).toHaveCount(1)
        await expect.poll(() => reads.held.length).toBeGreaterThan(0)
        const first = await acrossWidths(page, words.clear, lead)
        expectNoId('before the first answer', first, dimension, value.id)

        // Named by the answer.
        await reads.release()
        await expect(chip).toContainText(value.named)
        const named = await acrossWidths(page, words.clear, lead)

        // Another period: the chip's dimension read again, held.
        reads.hold(offering(value.dimension))
        await page.getByRole('radio', { name: words[period.next] }).click()
        await expect.poll(() => reads.held.length).toBeGreaterThan(0)
        const switching = await acrossWidths(page, words.clear, lead)
        await reads.release()
        await expect(page.locator('.analytics-bar-fresh time')).toBeVisible()
        await expect.poll(() => reads.held.length).toBe(0)
        const settled = await acrossWidths(page, words.clear, lead)

        // A refresh that fails leaves the name.
        fail(true)
        await failRefresh(page)
        const failed = await acrossWidths(page, words.clear, lead)

        const states = { first, named, switching, settled, failed }
        const cutAt = await expectHints(page, `${dimension}: ${value.named}`, settled)
        await record(info, `bar chips read ${locale} ${from} ${kind}`, { ...states, cutAt })
        expectNoId('read again for another period', switching, dimension, value.id)
        for (const [name, seen] of Object.entries(states)) expectOneLine(name, seen)
        expectPlaceholder(first)
        for (const [name, seen] of Object.entries({ named, switching, settled, failed }))
          expectNameFirst(name, seen)
        expectSteadyLead(named, { switching, settled, failed })
        expectClearStill(states)
        for (const width of WIDTHS) {
          const was = named[width]?.chips
          expect
            .soft(switching[width]?.chips, `switching at ${width}px: the chip's name`)
            .toEqual(was)
          expect.soft(settled[width]?.chips, `settled at ${width}px: the chip's name`).toEqual(was)
          expect.soft(failed[width]?.chips, `failed at ${width}px: the chip's name`).toEqual(was)
          const height = settled[width]?.bar
          for (const [name, seen] of Object.entries(states))
            expect.soft(seen[width]?.bar, `${name} at ${width}px: the bar's height`).toBe(height)
        }
        expectBothHints(kind, cutAt)
      })

/**
 * Two chips keep their words, the row wrapping where it has no room for them, at a phone's widths
 * and on the wider bars.
 */
for (const locale of ['ru', 'en'] as const)
  test(`two chips keep their words and wrap in ${locale}`, async ({ page }, info) => {
    const words = WORDS[locale]
    await page.addInitScript((chosen) => localStorage.setItem('valkama-locale', chosen), locale)
    await serveFailing(page, WIDTHS[0])
    const filters = JSON.stringify({
      [VALUES.task.dimension]: [VALUES.task.id],
      [VALUES.project.dimension]: [VALUES.project.id],
    })
    await page.goto(pageAt({ filters }))
    const chip = page.locator('.analytics-bar [data-filter-chip]')
    await expect(chip).toHaveCount(2)
    for (const named of [VALUES.task.named, VALUES.project.named])
      await expect(chip.filter({ hasText: named })).toHaveCount(1)
    const seen = await acrossWidths(page, words.clear, `${words.dimensions.task}:`, [
      ...WIDTHS,
      620,
      1024,
      1440,
    ])
    await record(info, `bar chips two ${locale}`, seen)
    for (const [width, state] of Object.entries(seen)) {
      expect.soft(state.chips, `${width}px: the chips`).toHaveLength(2)
      expect.soft(state.cut, `${width}px: a chip cut`).toEqual([false, false])
      const right = Math.max(...state.boxes.map((box) => box?.right ?? Number.NaN))
      expect.soft(right, `${width}px: a chip past the window`).toBeLessThanOrEqual(state.window)
    }
  })
