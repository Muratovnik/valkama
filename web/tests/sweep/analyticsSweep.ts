/**
 * A sweep of the Analytics page and its value panel on a running Valkama, for three classes of
 * defect that a test on one named spot kept missing elsewhere on real data: hover reach (the hint
 * or the hover state the pointer gets at and around every mark), sideways overflow that is none of
 * the design's, and text that must never show (`--forbid`) as the product's own words, not where
 * a name of the data shown quotes it. It walks every section the rail
 * offers, every period the bar offers, every view each chart's switch offers and the value panel
 * opened from a mark of each section, at each width, and writes every miss with where it stood.
 * It walks the measure the page opens on; `--measures time,tokens,cost` walks each one named
 * instead, since a column a measure adds or a figure it words otherwise changes what a table
 * holds and how wide it is.
 *
 *   python tests/isolated.py serve --out tmp/<name>/stand --store-copy
 *   cd web
 *   node tests/sweep/analyticsSweep.ts --url http://127.0.0.1:<port>/ --out ../tmp/<name>/sweep \
 *     --forbid "меньше минуты" [--widths 1440,390] [--sections quota_week] [--periods week]
 *     [--measures time,tokens,cost]
 *   cd ..
 *   python tests/isolated.py stop --out tmp/<name>/stand
 *
 * `--out` must lie under the repository's ignored `tmp/`, since what a store copy shows is the
 * owner's: the run refuses any other. It writes `sweep.json` there — every miss with its state, a
 * selector path, the owning component, the offsets and what was found instead, and a summary by
 * class and owner — and exits 1 when anything missed, 2 when the run itself failed. The rules each
 * class judges by are in `sweepRules.ts`; how the page is walked, in `sweepStates.ts`.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

import { chromium } from '@playwright/test'
import type { Browser, Page } from '@playwright/test'

import { installHelpers, readForbidden, readOverflow, watchNames } from './sweepPage.ts'
import { rest, sweepReach } from './sweepReach.ts'
import { occurrences, panelNote, scrollMiss } from './sweepRules.ts'
import { chartViews, chooseView, discover, MEASURES, openPanel, openView } from './sweepStates.ts'
import type { PeriodChoice } from './sweepStates.ts'
import { summarize } from './sweepSummary.ts'
import type { Miss, StateName } from './sweepSummary.ts'

const { values } = parseArgs({
  options: {
    forbid: { type: 'string', multiple: true, default: [] },
    marks: { type: 'string', default: '6' },
    measures: { type: 'string' },
    out: { type: 'string' },
    periods: { type: 'string' },
    sections: { type: 'string' },
    url: { type: 'string' },
    widths: { type: 'string', default: '1440,1280,1024,390' },
    workers: { type: 'string', default: '6' },
  },
})

/** A comma-separated option as its items, or null where it was not given. */
function list(value: string | undefined): string[] | null {
  return value
    ? value
        .split(',')
        .map((one) => one.trim())
        .filter(Boolean)
    : null
}

/** Refuses a run that could not say anything, before a browser starts. */
function refuse(why: string): never {
  console.error(`analyticsSweep: ${why}`)
  process.exit(2)
}

const scratch = fileURLToPath(new URL('../../../tmp/', import.meta.url))
if (!values.url || !values.out) refuse('--url and --out are required')
const out = resolve(values.out)
if (relative(scratch, out).startsWith('..') || resolve(scratch) === out)
  refuse(
    `${out} is not under ${scratch}, which Git ignores; a sweep of a store copy writes the owner's data`,
  )
mkdirSync(out, { recursive: true })
const base = values.url
const forbid = values.forbid
const perSort = Number(values.marks)
const widths = (list(values.widths) ?? []).map(Number)
/** The measures each view is opened with; the empty one is the measure the page opens on. */
const measures = list(values.measures) ?? ['']
const unknown = measures.filter((one) => one && !MEASURES.includes(one))
if (unknown.length) refuse(`--measures names no measure of the page: ${unknown.join(', ')}`)

/** What one state of the page gave: its misses and how many points the pointer stood on. */
interface Measured {
  misses: Miss[]
  pointed: number
}

/** The sideways scrolls of `scope` that are none of the design's. */
async function overflowMisses(page: Page, state: StateName, scope: string | null): Promise<Miss[]> {
  const misses: Miss[] = []
  for (const box of await readOverflow(page, scope)) {
    const miss = scrollMiss(box)
    if (!miss || !box.inScope) continue
    // What widens a box out of the flow belongs to the component that put it there, not the box.
    const cause = miss.rule === 'sliver' || miss.rule === 'not-a-row' ? undefined : box.escapees[0]
    misses.push({
      class: 'overflow',
      rule: miss.rule,
      state,
      path: box.path,
      owner: cause?.owner ?? box.owner,
      detail: {
        by: miss.by,
        scroll: `${box.scrollWidth}/${box.clientWidth}`,
        scroller: box.owner,
        maker: box.maker,
        escapees: box.escapees.slice(0, 4),
      },
    })
  }
  return misses
}

/**
 * Every place of `scope` where a forbidden text stands as the product's own words, not inside a
 * name of the data shown (`names`), once per place and words.
 */
async function forbiddenMisses(
  page: Page,
  state: StateName,
  { scope, names }: { names: readonly string[]; scope: string | null },
): Promise<Miss[]> {
  const seen = new Set<string>()
  const misses: Miss[] = []
  for (const found of await readForbidden(page, forbid, scope)) {
    const key = `${found.path}|${found.said}`
    if (seen.has(key) || !occurrences(found.raw, found.text, names, found.contexts)) continue
    seen.add(key)
    misses.push({
      class: 'forbidden',
      rule: found.text,
      state,
      path: found.path,
      owner: found.owner,
      detail: { where: 'page', said: found.said },
    })
  }
  return misses
}

/** The names of the data a page was shown so far (`watchNames`). */
type Names = () => Promise<string[]>

/**
 * Measures the page as it stands: overflow and forbidden text of `scope` (all of it where null),
 * read with no hint up, then the reach of its marks.
 */
async function measure(
  page: Page,
  state: StateName,
  { scope, names }: { names: Names; scope: string | null },
): Promise<Measured> {
  await rest(page)
  const known = await names()
  const misses = [
    ...(await overflowMisses(page, state, scope)),
    ...(await forbiddenMisses(page, state, { scope, names: known })),
  ]
  const reach = await sweepReach(page, { forbid, names: known, perSort, scope })
  for (const miss of reach.misses)
    misses.push({
      class: 'reach',
      rule: miss.rule,
      state,
      path: miss.path,
      owner: miss.owner,
      detail: { offset: miss.offset, expected: miss.expected, found: miss.found },
    })
  for (const said of reach.said)
    misses.push({
      class: 'forbidden',
      rule: said.text,
      state,
      path: said.path,
      owner: said.owner,
      detail: { where: 'hint', said: said.said },
    })
  return { misses, pointed: reach.pointed }
}

/** One period of one section at one width: the views it opens on, every other view, the panel. */
async function walkPeriod(
  page: Page,
  view: Record<string, string>,
  state: (name: string, panel?: boolean) => StateName,
  { notes, names }: { names: Names; notes: string[] },
) {
  const results: Measured[] = []
  const named = state('')
  const at = `${named.width} ${named.section} ${named.period}`
  if (!(await openView(page, base, view))) notes.push(`${at}: did not settle`)
  results.push(await measure(page, state('opening'), { scope: null, names }))
  for (const chart of await chartViews(page)) {
    const others = Array.from({ length: chart.options }, (_, option) => option).filter(
      (option) => option !== chart.chosen,
    )
    for (const option of others) {
      const shown = await chooseView(page, chart.chart, option)
      results.push(
        await measure(page, state(`${chart.chart}:${shown}`), {
          scope: '[data-sweep-scope]',
          names,
        }),
      )
    }
    if (others.length) await chooseView(page, chart.chart, chart.chosen)
  }
  await openView(page, base, view)
  const { acting, opener } = await openPanel(page, base, view)
  if (opener)
    results.push(
      await measure(page, state(`panel from ${opener}`, true), {
        scope: '.analytics-detail',
        names,
      }),
    )
  const note = panelNote(acting, opener !== null)
  if (note) notes.push(`${at}: ${note}`)
  return results
}

/**
 * Walks one section at one width: every period under each measure asked for, every view of every
 * chart, and the panel.
 */
async function walkSection(
  browser: Browser,
  width: number,
  section: string,
  periods: readonly PeriodChoice[],
) {
  const context = await browser.newContext({ locale: 'ru-RU', viewport: { width, height: 1000 } })
  await installHelpers(context)
  const watched = watchNames(context)
  const names = watched.names
  context.setDefaultTimeout(15_000)
  const page = await context.newPage()
  const results: Measured[] = []
  const notes: string[] = []
  for (const measure of measures)
    for (const period of periods) {
      const state = (name: string, panel = false): StateName => ({
        width,
        section,
        period: period.period,
        measure,
        view: name,
        panel,
      })
      const view = { ...period, by: section, ...(measure ? { measure } : {}) }
      try {
        results.push(...(await walkPeriod(page, view, state, { notes, names })))
      } catch (error) {
        const at = [width, section, period.period, measure].filter(Boolean).join(' ')
        notes.push(`failed: ${at}: ${String(error).slice(0, 300)}`)
      }
    }
  const unread = watched.unread()
  if (unread)
    notes.push(`${width} ${section}: ${unread} API answers not read in time, their names unknown`)
  await context.close()
  return { results, notes }
}

/** What the page offers, read once at the widest width, narrowed by `--sections` and `--periods`. */
async function offered(browser: Browser) {
  const context = await browser.newContext({
    locale: 'ru-RU',
    viewport: { width: 1440, height: 1000 },
  })
  await installHelpers(context)
  const found = await discover(await context.newPage(), base)
  await context.close()
  const periods = list(values.periods)
  return {
    sections: list(values.sections) ?? found.sections,
    periods: found.periods.filter((one) => !periods || periods.includes(one.period)),
  }
}

async function main() {
  const started = Date.now()
  const browser = await chromium.launch({ ignoreDefaultArgs: ['--hide-scrollbars'] })
  const { sections, periods } = await offered(browser)
  const jobs = widths.flatMap((width) => sections.map((section) => ({ width, section })))
  const misses: Miss[] = []
  const notes: string[] = []
  let pointed = 0
  let states = 0
  const worker = async () => {
    for (let job = jobs.shift(); job; job = jobs.shift()) {
      const done = await walkSection(browser, job.width, job.section, periods)
      for (const result of done.results) misses.push(...result.misses)
      pointed += done.results.reduce((sum, result) => sum + result.pointed, 0)
      states += done.results.length
      notes.push(...done.notes)
      console.log(
        `${job.width} ${job.section}: ${done.results.length} states, ${misses.length} misses so far`,
      )
    }
  }
  await Promise.all(Array.from({ length: Number(values.workers) }, worker))
  await browser.close()
  const minutes = Math.round((Date.now() - started) / 6000) / 10
  const summary = summarize(misses)
  const run = {
    url: base,
    widths,
    sections,
    periods,
    measures,
    forbid,
    perSort,
    states,
    pointed,
    minutes,
    notes,
  }
  writeFileSync(join(out, 'sweep.json'), JSON.stringify({ run, summary, misses }, null, 1))
  console.log(`${states} states, ${pointed} points, ${misses.length} misses in ${minutes} min`)
  for (const group of summary.groups)
    console.log(`${group.class} ${group.rule} ${group.owner}: ${group.count}`)
  for (const note of notes) console.log(`note: ${note}`)
  console.log(`wrote ${join(out, 'sweep.json')}`)
  const failed = notes.some((note) => note.startsWith('failed'))
  process.exitCode = failed ? 2 : Math.sign(misses.length)
}

await main()
