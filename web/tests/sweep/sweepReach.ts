/**
 * The hover-reach class of the Analytics sweep: the real pointer (`page.mouse.move`) at a mark's
 * centre and `NUDGE` off it on each axis, a ring's sector also along its band, and what the page
 * answered there against what the product's rules (`sweepRules.ts`) expect. Every hinted element
 * is a mark here; a chart's many marks of one sort, such as a step line's readings, are sampled
 * evenly, `perSort` of each sort, since one sort shares one rule.
 */
import type { Page } from '@playwright/test'

import type { Hinted, MarkAround, Surface } from './sweepInPage.ts'
import { readAround, readHinted, readSurface } from './sweepPage.ts'
import {
  boxDistance,
  expectedAmong,
  expectedOnLine,
  judge,
  NUDGE,
  occurrences,
} from './sweepRules.ts'
import type { Point } from './sweepRules.ts'

/** One point where the page answered other than the rules expect. */
interface ReachMiss {
  expected: string[]
  found: string
  offset: string
  owner: string
  path: string
  rule: string
}

/** A forbidden text a shown hint said. */
interface HintSaid {
  owner: string
  path: string
  said: string
  text: string
}

/** How long a hint may take to come where it should, in ms: the manager's rest, its fade, slack. */
const PATIENCE = 1200

/** Where the pointer of each page stands, as the sweep last put it. */
const pointers = new WeakMap<Page, Point>()

/** `count` of `all`, spread evenly from the first to the last; one is the middle one. */
function spread<T>(all: readonly T[], count: number): T[] {
  if (all.length <= count) return [...all]
  if (count < 2) return all.slice(0, count).map(() => all[Math.floor(all.length / 2)])
  return Array.from(
    { length: count },
    (_, index) => all[Math.round((index * (all.length - 1)) / (count - 1))],
  )
}

/** The marks to point at: of each sort, `perSort` spread along it. */
function sample(hinted: readonly Hinted[], perSort: number): Hinted[] {
  const sorts = new Map<string, Hinted[]>()
  for (const one of hinted) sorts.set(one.sort, [...(sorts.get(one.sort) ?? []), one])
  return [...sorts.values()].flatMap((sort) => spread(sort, perSort))
}

/** Takes the pointer to the window's corner and waits until no hint is up. */
export async function rest(page: Page) {
  await page.mouse.move(1, 1)
  pointers.set(page, { x: 1, y: 1 })
  const started = Date.now()
  while (Date.now() - started < PATIENCE && (await readSurface(page, '')))
    await page.waitForTimeout(40)
}

/**
 * Points at `at` and waits until a hint that may answer shows, or `PATIENCE` runs out. A hint
 * still up over `at` would keep the pointer, as a hint the pointer may enter does by design, and a
 * move to where the pointer already is moves nothing the page hears, which happens where a scroll
 * brought the next mark under the pointer: in both the pointer first leaves for the window's
 * corner, as a reader's would to aim anew.
 */
async function pointAt(page: Page, at: Point, aimed: string, expected: readonly string[]) {
  const before = await readSurface(page, aimed)
  const still = pointers.get(page)
  const unmoved = still !== undefined && Math.hypot(still.x - at.x, still.y - at.y) < 1
  if (unmoved || (before && boxDistance(before.box, at) <= NUDGE)) await rest(page)
  await page.mouse.move(at.x, at.y)
  pointers.set(page, at)
  const started = Date.now()
  let surface: Surface | null = null
  while (Date.now() - started < PATIENCE) {
    await page.waitForTimeout(40)
    surface = await readSurface(page, aimed)
    if (surface?.says.some((id) => expected.includes(id))) return surface
  }
  return surface
}

/** What a sweep of one state found. */
interface Found {
  misses: ReachMiss[]
  pointed: number
  said: HintSaid[]
}

/** Points at each point of one mark and adds what missed and what forbidden text a hint said. */
async function pointAround(
  page: Page,
  { mark, around }: { around: MarkAround; mark: Hinted },
  options: { forbid: readonly string[]; name: (id: string) => string },
  found: Found,
) {
  for (const point of around.points) {
    const expected = around.line
      ? expectedOnLine(around.line.marks, point.at.x, around.line.reach)
      : expectedAmong(point.nearby, mark.id, point.at)
    const surface = await pointAt(page, point.at, mark.id, expected)
    found.pointed += 1
    for (const text of options.forbid.filter((one) => surface && occurrences(surface.text, one)))
      found.said.push({
        text,
        said: surface?.text.slice(0, 120) ?? '',
        path: mark.path,
        owner: mark.owner,
      })
    for (const verdict of judge(
      surface,
      expected,
      { id: mark.id, place: around.place },
      point.at,
    )) {
      const what =
        'ids' in verdict.found
          ? verdict.found.ids.map((id) => options.name(id)).join(' | ')
          : verdict.found.text
      found.misses.push({
        rule: verdict.rule,
        found: verdict.rule === 'no-hint' ? 'no hint' : what.slice(0, 160),
        offset: point.offset,
        expected: expected.map((id) => options.name(id)),
        path: mark.path,
        owner: mark.owner,
      })
    }
  }
}

/**
 * Points at every sampled mark of the page, or of the elements in `scope` alone, and answers each
 * miss and each forbidden text a shown hint said. Ids name the elements only within this reading.
 */
export async function sweepReach(
  page: Page,
  options: { forbid: readonly string[]; perSort: number; scope: string | null },
): Promise<Found> {
  const hinted = await readHinted(page, options.scope)
  const byId = new Map(hinted.map((one) => [one.id, one.path]))
  const name = (id: string) => byId.get(id) ?? `#${id}`
  const found: Found = { misses: [], pointed: 0, said: [] }
  for (const mark of sample(hinted, options.perSort)) {
    const around = await readAround(page, mark.id, NUDGE)
    if (!around) continue
    // A scroll closes the hint and asks again for whatever the pointer then rests on.
    if (around.scrolled) await rest(page)
    await pointAround(page, { mark, around }, { forbid: options.forbid, name }, found)
  }
  await rest(page)
  return { ...found, said: dedupe(found.said) }
}

/** One of each forbidden text a hint said at one mark. */
function dedupe(said: readonly HintSaid[]): HintSaid[] {
  const seen = new Set<string>()
  return said.filter((one) => {
    const key = `${one.text}|${one.path}|${one.said}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
