/**
 * A pair's name keeps its second part whole, in the real app, in the «Model» section split by
 * «Effort», in English and in Russian, at 1280 by 800 and 1440 by 900 and at the widths DESIGN.md
 * names for the page's layout: 1024, where the bar is two rows; 1107 and 1108, either side of the
 * bar's 50rem; 1200 and 1300, the ends of the band its one line was measured over. A name that
 * does not fit cuts its first part, the model, and the separator and the effort stand whole after
 * it, «claude-opus-5-… · medium»: cut from its end, «claude-opus-5-5 · …» stood twice in the bars
 * at 1440 in English, and two rows read as one.
 *
 * In the bars, the small charts' names, the day chart's legend and the table, every name is its
 * whole pair, and the separator and the second part are inside every box that clips them. The
 * small charts' names at 1200 in English are cut, so the run holds the cut case and not only
 * names that fit. The bars give a pair's name a line of its own, where these pairs fit; the task
 * pairs' spec holds their cut case, with titles longer than any line. A cut name is said whole in
 * its hint, or in the table, where it is all its hint says, laid whole over itself, and each name
 * of the table, its row's control, is named by its whole pair, as a cut one is too. Each run
 * prints what it measured.
 *
 * The Model section's table cuts no model's id (`DESIGN.md`, Long titles: the owner's decision of
 * 2026-11-24): its column keeps the room of the longest id and of the start of the other value
 * after it, so an effort's pair stands whole there at every size, where it was cut at 1200 in
 * English. Its cut case is the Model section split by task: the id stands whole and the task's
 * title, longer than any line beside it, stays on the id's line and is cut at its own end, with an
 * ellipsis and a hint that says the pair whole, while the short task's pair stands whole with no
 * hint. That the second part of a pair, a task or a session, keeps the id's line and is cut there
 * rather than taking a line of its own is the owner's decision of 2026-11-24.
 *
 * A control of a bar, a small chart or the legend is named by what pressing it does, which for a
 * pair names its model alone: «Details of claude-opus-5-5» names the high and the medium row
 * alike, and descriptions that said only their figures left a screen reader nothing to tell them
 * apart by. Each is described by its whole pair, as the browser computes it, and no two of one
 * chart are named and described alike; a single value's controls keep their name and description.
 *
 * A table's name is laid whole only while it is cut. The press's hit area stands 12px past its
 * words to each side and 8px over and under, and counted as a cut it raised the hint of every
 * name, «claude-sonnet-5-5 · high» whole at 1280 in Russian among them.
 *
 * A single model's id stands whole in a table's button, on one line, however long: a 50-character
 * synthetic name was cut at the button's edge, «claude-opus-5-5-with-a-rather-», before ids were
 * kept whole; its column is now as wide as it, and the frame scrolls where the window is
 * narrower than the table it makes, which the run prints.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { task, value } from '../fixtures/analytics.ts'
import type { TimedStretch } from '../fixtures/analytics.ts'
import {
  LEGEND_NAMES,
  LEGEND_SERIES,
  NOW,
  openReport,
  pageAt,
  record,
  serve,
} from './analyticsPage.ts'
import { drawLined } from './drawnViews.ts'
import { hint as hintUp } from './hintFramesPage.ts'
import { pairNames } from './pairNames.ts'
import { test } from './test.ts'

const HOUR = 3600
const at = (day: number) => new Date(2026, 10, day, 10)

/** One stretch of a model at an effort, `hours` long, on a day of November. */
const stretch = (day: number, model: string, effort: string, hours: number): TimedStretch => ({
  at: at(day),
  group: { model: value(model), effort: value(effort) },
  spend: { seconds: hours * HOUR },
})

/** The week so far, five pairs of three models at two efforts, largest first as `PAIRS`. */
const WORLD: TimedStretch[] = [
  stretch(9, 'claude-opus-5-5', 'high', 4),
  stretch(9, 'claude-sonnet-5-5', 'medium', 1),
  stretch(10, 'claude-opus-5-5', 'high', 2),
  stretch(10, 'claude-opus-5-5', 'medium', 3),
  stretch(11, 'claude-sonnet-5-5', 'high', 2),
  stretch(11, 'claude-haiku-5-5', 'high', 0.5),
]

const PAIRS = [
  'claude-opus-5-5 · high',
  'claude-opus-5-5 · medium',
  'claude-sonnet-5-5 · high',
  'claude-sonnet-5-5 · medium',
  'claude-haiku-5-5 · high',
]

const SPLIT = pageAt({ by: 'model', across: 'effort' })

/** Where a pair's name stands on the page, by what the run calls each place. */
const PLACES = {
  bars: '.spending-bars .ranked-label',
  multiples: '.spending-multiples .multiple-name',
  legend: `.spending-days ${LEGEND_NAMES}`,
  table: '.spending-table tbody th .table-name',
} as const

/** The window sizes: the two the change was reported at, and the widths of the page's bands. */
const SIZES = [
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
  ...[1024, 1107, 1108, 1200, 1300].map((width) => ({ width, height: 900 })),
]

/**
 * The split section open in `locale` at a window size, with its pairs read. On a `held` clock the
 * page's timers run only as the test moves them, so it can say that a hint did not come after its
 * delay; the frames the page draws are then moved on that clock too.
 */
async function openPairs(
  page: Page,
  locale: 'en' | 'ru',
  size: (typeof SIZES)[number],
  held = false,
) {
  await page.addInitScript((chosen) => localStorage.setItem('valkama-locale', chosen), locale)
  if (held) await page.clock.install({ time: NOW })
  await serve(page, WORLD)
  await openReport(page, size.width, SPLIT)
  await page.setViewportSize(size)
  await expect(page.locator(PLACES.bars).first()).toHaveText(PAIRS[0] ?? '')
  await page.evaluate(() => document.fonts.ready)
  await (held
    ? page.clock.runFor(100)
    : page.evaluate(
        () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
      ))
}

type Measured = Awaited<ReturnType<typeof pairNames>>

/**
 * The hint the first cut name of a place shows under the pointer, with the pair it names: a box
 * that says the cut words before what it adds, or the words laid whole over the cut ones where
 * they are all it says; null where no name of the place is cut.
 */
async function hintOfCut(page: Page, place: Locator, found: Measured) {
  const index = found.findIndex((one) => one.cut)
  if (index < 0) return null
  await page.mouse.move(0, 0)
  await expect(hintUp(page)).toHaveCount(0)
  await place.nth(index).hover()
  const hint = hintUp(page)
  await expect(hint).toBeVisible()
  return { pair: found[index]?.words ?? '', hint: (await hint.textContent()) ?? '' }
}

/** The places whose cut name has a hint that does not say its whole pair. */
const hintsShort = (hints: Record<string, Awaited<ReturnType<typeof hintOfCut>>>) =>
  Object.entries(hints)
    .filter(([, one]) => one && !one.hint.includes(one.pair))
    .map(([where]) => where)

/**
 * Whether the small charts hold a cut name in English at 1200, so the run holds the cut case;
 * elsewhere a name may fit or not, and nothing is held there.
 */
const cutWhereHeld = (locale: string, width: number, measured: Record<string, Measured>) =>
  locale !== 'en' || width !== 1200 || (measured.multiples ?? []).some((one) => one.cut)

for (const locale of ['en', 'ru'] as const)
  for (const size of SIZES)
    test(`in ${locale} at ${size.width}×${size.height}, a pair's name keeps its second part whole`, async ({
      page,
    }, info) => {
      await openPairs(page, locale, size)
      const measured = {
        bars: await pairNames(page, PLACES.bars),
        multiples: await pairNames(page, PLACES.multiples),
        legend: await pairNames(page, PLACES.legend),
        table: await pairNames(page, PLACES.table),
      }
      const hints: Record<string, Awaited<ReturnType<typeof hintOfCut>>> = {}
      for (const [where, found] of Object.entries(measured)) {
        const place = page.locator(PLACES[where as keyof typeof PLACES])
        hints[where] = await hintOfCut(page, place, found)
      }
      await record(info, `pair names ${locale} ${size.width}`, { ...measured, hints })

      for (const [where, found] of Object.entries(measured)) {
        // Every place names every pair whole, in the order of the bars.
        expect(
          found.map((one) => one.words),
          where,
        ).toEqual(PAIRS)
        // The separator and the second part stand inside every box that clips them.
        for (const one of found) expect(one.hidden, `${where}: ${one.words}`).toBe(0)
      }
      // A cut name says its whole pair in its hint.
      expect(hintsShort(hints)).toEqual([])
      // The cut case: in English at 1200 the small charts' names are cut.
      expect(cutWhereHeld(locale, size.width, measured)).toBe(true)
      // The table cuts none: the id stands whole, and the effort in the room kept after it.
      expect(measured.table.filter((one) => one.cut).map((one) => one.words)).toEqual([])

      // Each name of the table is its row's control, named by its whole pair, cut or not.
      const presses = page.locator('.spending-table tbody th .chart-press')
      await expect(presses).toHaveCount(PAIRS.length)
      for (const [index, pair] of PAIRS.entries())
        await expect(presses.nth(index)).toHaveAccessibleName(pair)
    })

/** The controls of each chart that names its values, where a press opens one's side panel. */
const CONTROLS = {
  bars: '.spending-bars .ranked-line:is(button, a)',
  multiples: '.spending-multiples .multiple-name:is(button, a)',
  legend: `.spending-days ${LEGEND_SERIES}:is(button, a)`,
} as const

/** What a control that opens a model's side panel is called, in each language. */
const ACTION = {
  en: (model: string) => `Details of ${model}`,
  ru: (model: string) => `Подробнее: ${model}`,
}

/** Each control a selector finds, by the name and description the browser computed for it. */
async function described(page: Page, selector: string) {
  const session = await page.context().newCDPSession(page)
  try {
    const { root } = await session.send('DOM.getDocument', { depth: -1 })
    const { nodeIds } = await session.send('DOM.querySelectorAll', {
      nodeId: root.nodeId,
      selector,
    })
    const found: { description: string; name: string }[] = []
    for (const nodeId of nodeIds) {
      const { nodes } = await session.send('Accessibility.getPartialAXTree', {
        nodeId,
        fetchRelatives: false,
      })
      const [node] = nodes
      found.push({
        description: String(node?.description?.value ?? ''),
        name: String(node?.name?.value ?? ''),
      })
    }
    return found
  } finally {
    await session.detach()
  }
}

/** The model of a pair, its first part. */
const modelOf = (pair: string) => pair.split(' · ')[0] ?? pair

/**
 * Whether the table's name at `index` shows a hint under the pointer, its words laid whole over it
 * or any other, on a page whose clock is held (`openPairs`): a hint shows after the manager's delay
 * of half a second, so a name whose hint has not come when the clock has moved a second past the
 * pointer's arrival has none.
 */
async function hintShows(page: Page, index: number) {
  const name = page.locator(PLACES.table).nth(index)
  // In view before the pointer comes, since a scroll closes a hint.
  await name.scrollIntoViewIfNeeded()
  await page.mouse.move(0, 0)
  await page.clock.runFor(1000)
  await expect(hintUp(page)).toHaveCount(0)
  await name.hover()
  await page.clock.runFor(1000)
  // The hint is placed in steps that wait on each other and on frames of that clock, so it is
  // given a few more of them, a second in all, before it counts as not come.
  for (let step = 0; step < 10; step += 1) {
    if (await hintUp(page).isVisible()) return true
    await page.clock.runFor(100)
  }
  return false
}

/** A task whose title is longer than any line a table's name has beside a model's id. */
const LONG_TASK =
  'Keep the period switch beside the measure and hold its words whole on a narrow screen'
/**
 * The Model section split by task: a model at the long task, and a short one at a short task,
 * whose pair fits the room the column keeps after the longest id.
 */
const TASK_WORLD: TimedStretch[] = [
  {
    at: at(9),
    group: { model: value('claude-opus-5-5'), work_item: task(2, LONG_TASK) },
    spend: { seconds: 4 * HOUR },
  },
  {
    at: at(10),
    group: { model: value('claude-5'), work_item: task(3, 'Fix') },
    spend: { seconds: 2 * HOUR },
  },
]
const TASK_PAIRS = [`claude-opus-5-5 · MAIN-2 ${LONG_TASK}`, 'claude-5 · MAIN-3 Fix']

/** Each pair of the table as drawn: its id and whether the id or the rest is cut, and how. */
const pairParts = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('.spending-table tbody th .pair-name')].map((pair) => {
      const start = pair.querySelector('.pair-start')
      const end = pair.querySelector('.pair-end')
      if (!start || !end) throw new Error('a pair with no two parts')
      // Wider laid out whole than its box: this body runs in the page, so it stays here.
      // eslint-disable-next-line unicorn/consistent-function-scoping -- see above
      const cut = (part: Element) => {
        const range = document.createRange()
        range.selectNodeContents(part)
        return range.getBoundingClientRect().width > part.getBoundingClientRect().width + 0.5
      }
      // eslint-disable-next-line unicorn/consistent-function-scoping -- runs in the page, as `cut`
      const top = (part: Element) => Math.round(part.getBoundingClientRect().top)
      return {
        id: start.textContent?.trim() ?? '',
        idCut: cut(start),
        restCut: cut(end),
        ellipsis: getComputedStyle(end).textOverflow === 'ellipsis',
        oneLine: top(start) === top(end),
      }
    }),
  )

for (const locale of ['en', 'ru'] as const)
  for (const size of SIZES) {
    test(`in ${locale} at ${size.width}×${size.height}, a pair's controls are described by the whole pair`, async ({
      page,
    }, info) => {
      await openPairs(page, locale, size)
      const controls = {
        bars: await described(page, CONTROLS.bars),
        multiples: await described(page, CONTROLS.multiples),
        legend: await described(page, CONTROLS.legend),
      }
      await record(info, `pair descriptions ${locale} ${size.width}`, controls)
      for (const [where, found] of Object.entries(controls)) {
        expect(found, where).toHaveLength(PAIRS.length)
        for (const [index, pair] of PAIRS.entries()) {
          const control = found[index]
          // Named by what pressing it does, with the model it acts as; described by its pair.
          expect(control?.name, `${where}: ${pair}`).toBe(ACTION[locale](modelOf(pair)))
          expect(control?.description, `${where}: ${pair}`).toContain(pair)
        }
        // No two controls of one chart are named and described alike.
        const said = found.map((one) => `${one.name}\n${one.description}`)
        expect(new Set(said).size, where).toBe(said.length)
      }
    })

    test(`in ${locale} at ${size.width}×${size.height}, a table's name has its hint only while it is cut`, async ({
      page,
    }, info) => {
      await openPairs(page, locale, size, true)
      const found = await pairNames(page, PLACES.table)
      // A row of the table for every pair.
      expect(found, 'the names of the table').toHaveLength(PAIRS.length)
      const hints: boolean[] = []
      for (const index of found.keys()) hints.push(await hintShows(page, index))
      const seen = found.map((one, index) => ({
        words: one.words,
        cut: one.cut,
        hint: hints[index],
      }))
      await record(info, `table hints ${locale} ${size.width}`, seen)
      for (const one of seen) expect(one.hint, `${one.words}, cut: ${one.cut}`).toBe(one.cut)
      // The id stands whole, and the effort in the room kept after it: none is cut, none hinted.
      expect(seen.filter((one) => one.cut || one.hint)).toEqual([])
    })

    test(`in ${locale} at ${size.width}×${size.height}, split by task, the id stands whole and the task is cut at its end, with its hint only while cut`, async ({
      page,
    }, info) => {
      await page.addInitScript((chosen) => localStorage.setItem('valkama-locale', chosen), locale)
      await page.clock.install({ time: NOW })
      await serve(page, TASK_WORLD)
      await openReport(page, size.width, pageAt({ by: 'model', across: 'work_item' }))
      await page.setViewportSize(size)
      await expect(page.locator(PLACES.table)).toHaveCount(TASK_PAIRS.length)
      await page.evaluate(() => document.fonts.ready)
      await page.clock.runFor(100)
      const found = await pairNames(page, PLACES.table)
      const parts = await pairParts(page)
      const hints: boolean[] = []
      for (const index of found.keys()) hints.push(await hintShows(page, index))
      await record(info, `task pairs ${locale} ${size.width}`, { found, parts, hints })
      expect(found.map((one) => one.words)).toEqual(TASK_PAIRS)
      // The long task's pair is cut, the short one's whole; the hint comes only for the cut one.
      expect(found.map((one) => one.cut)).toEqual([true, false])
      expect(hints).toEqual([true, false])
      // The cut is the task's, on the id's line and at its own end with an ellipsis (the owner's
      // decision of 2026-11-24); the id stands whole in both.
      expect(parts).toEqual([
        { id: 'claude-opus-5-5', idCut: false, restCut: true, ellipsis: true, oneLine: true },
        { id: 'claude-5', idCut: false, restCut: false, ellipsis: true, oneLine: true },
      ])
      // Each name is its row's control, named by its whole pair, cut or not.
      const presses = page.locator('.spending-table tbody th .chart-press')
      for (const [index, pair] of TASK_PAIRS.entries())
        await expect(presses.nth(index)).toHaveAccessibleName(pair)
    })
  }

/**
 * A model whose name is 50 characters, longer than a table's name column held at any of the
 * sizes before ids were kept whole.
 */
const LONG_MODEL = 'claude-opus-5-5-with-a-rather-long-synthetic-names'
/**
 * A model whose name is shorter than the least a table's name column keeps, so it stands whole
 * at every size however much room the figures take.
 */
const SHORT_MODEL = 'claude-5'
const ONE_LONG: TimedStretch[] = [
  stretch(9, LONG_MODEL, 'high', 4),
  stretch(10, SHORT_MODEL, 'high', 2),
]

/**
 * Each table name's button: its words, whether they are cut — laid out wider than the box that
 * clips them — and whether that box's ellipsis reaches them. `text-overflow` draws its ellipsis
 * in the line boxes of the block that clips, so it ends the words only where they stand in that
 * block's own lines, with no box laid out whole between: a button is such a box whatever its
 * display says, and the words it held were cut at its edge with none.
 */
async function buttonNames(page: Page) {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('.spending-table tbody th button.chart-press')].map(
      (press) => {
        const walker = document.createTreeWalker(press, NodeFilter.SHOW_TEXT)
        let text = walker.nextNode() as Text | null
        while (text && !text.data.trim()) text = walker.nextNode() as Text | null
        let clip = text?.parentElement ?? null
        let whole = true
        while (clip && getComputedStyle(clip).overflowX === 'visible') {
          if (getComputedStyle(clip).display !== 'inline') whole = false
          clip = clip.parentElement
        }
        const range = document.createRange()
        if (text) range.selectNodeContents(text)
        const laid = range.getBoundingClientRect()
        const edges = clip?.getBoundingClientRect()
        return {
          words: press.textContent?.trim() ?? '',
          cut: Boolean(edges && laid.right > edges.right + 0.5),
          ellipsis: Boolean(clip && whole && getComputedStyle(clip).textOverflow === 'ellipsis'),
        }
      },
    ),
  )
}

for (const locale of ['en', 'ru'] as const)
  for (const size of SIZES)
    test(`in ${locale} at ${size.width}×${size.height}, a single model's id stands whole in a table's button`, async ({
      page,
    }, info) => {
      await page.addInitScript((chosen) => localStorage.setItem('valkama-locale', chosen), locale)
      await serve(page, ONE_LONG)
      await openReport(page, size.width, pageAt({ by: 'model' }))
      await page.setViewportSize(size)
      await expect(page.locator(PLACES.table)).toHaveCount(2)
      await page.evaluate(() => document.fonts.ready)
      const found = await buttonNames(page)
      const frame = await page
        .locator('.spending-table .chart-table-frame')
        .evaluate((box) => box.scrollWidth - box.clientWidth)
      await record(info, `single names ${locale} ${size.width}`, { found, frame })
      // The long id stands whole at every size, and so does the short one.
      expect(found.map((one) => ({ words: one.words, cut: one.cut }))).toEqual([
        { words: LONG_MODEL, cut: false },
        { words: SHORT_MODEL, cut: false },
      ])
    })

for (const locale of ['en', 'ru'] as const)
  test(`in ${locale}, a single value's controls are named by their action and described by their figures`, async ({
    page,
  }) => {
    await page.addInitScript((chosen) => localStorage.setItem('valkama-locale', chosen), locale)
    await serve(page, WORLD)
    await openReport(page, 1280, pageAt({ by: 'model' }))
    await drawLined(page.locator('.spending-bars'))
    const models = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5']
    await expect(page.locator(PLACES.bars)).toHaveText(models)
    for (const [where, selector] of Object.entries(CONTROLS)) {
      const found = await described(page, selector)
      expect(found, where).toHaveLength(models.length)
      for (const [index, model] of models.entries()) {
        expect(found[index]?.name, where).toBe(ACTION[locale](model))
        // The action says the name, so the description is the figures alone.
        expect(found[index]?.description, where).not.toContain(model)
        expect(found[index]?.description, where).not.toBe('')
      }
    }
  })
