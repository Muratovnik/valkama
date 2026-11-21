/**
 * What the Analytics sweep runs inside the page. Every function here is serialized into one script
 * a browser context runs before the page's own (`helperScript`), as `window.sweepHelpers`, so each
 * reaches the others through it and nothing of this module's scope. Every set is chosen by a hook
 * the product documents — `data-tooltip` for what has a hint, `data-hint-surface` for a shown hint,
 * `data-hint-pick` for a layer that picks among marks, `data-hint-mark` and `data-hint-point` for
 * where a hint stands, `data-shown` for a chart section — never by a styling class. A component's
 * root class is read only to name the owner of what was found (`OWNERS`), and the page's own
 * regions (`.analytics-page`, `.analytics-panel`, `.analytics-detail`) only to bound the reading.
 */
import { layoutHelpers } from './sweepInPageLayout.ts'
import { hintSays } from './sweepRules.ts'
import type { Box, MarkPlace, Point, Reachable } from './sweepRules.ts'

/** A component's root class and its name, to say who owns what was found. */
const OWNERS: readonly (readonly [string, string])[] = [
  ['chart-legend', 'ChartLegend'],
  ['chart-table-frame', 'ChartTable'],
  ['donut-chart', 'DonutChart'],
  ['period-columns', 'PeriodColumns'],
  ['ranked-bars', 'RankedBars'],
  ['small-multiples', 'SmallMultiples'],
  ['step-line', 'StepLine'],
  ['window-bar', 'WindowBar'],
  ['segmented', 'SegmentedControl'],
  ['analytics-rail', 'AnalyticsRail'],
  ['analytics-detail', 'DetailPanel'],
  ['dimension-panel', 'DimensionPanel'],
  ['overview-panel', 'OverviewPanel'],
  ['overview-top', 'OverviewTop'],
  ['quota-panel', 'QuotaPanel'],
  ['quota-account', 'QuotaAccount'],
  ['quota-window', 'QuotaWindow'],
  ['spending-table', 'SpendingTable'],
  ['spending-bars', 'SpendingBars'],
  ['spending-days', 'SpendingDays'],
  ['spending-multiples', 'SpendingMultiples'],
  ['spending-tiles', 'SpendingTiles'],
  ['kinds-panel', 'TokenKindsPanel'],
  ['kinds-table', 'TokenKindsTable'],
  ['value-days', 'ValueDays'],
  ['value-figures', 'ValueFigures'],
  ['chart-section', 'ChartSection'],
  ['analytics-panel', 'AnalyticsPanel'],
  ['analytics-page', 'AnalyticsView'],
]

/** The documented hooks a selector path names, beside the tag and the root class. */
const HOOKS = [
  'data-chart',
  'data-region',
  'data-shown',
  'data-hint-list',
  'data-target',
  'data-mark',
]

/** What the page reads where no scope is given: the page and its value panel. */
const WHOLE = '.analytics-page, .analytics-detail'

/** A hinted element of the page as the sweep first finds it. */
export interface Hinted {
  id: string
  kind: string
  owner: string
  path: string
  /** What sets it apart from its neighbours of one chart, to sample each sort of mark. */
  sort: string
}

/** A step line around a mark: its marks' x, whether each is a place, and the reach of a mark. */
interface LineAround {
  marks: { id: string; place: boolean; x: number }[]
  reach: number
}

/** Where to put the pointer on a mark, and what may answer at each point. */
export interface MarkAround {
  line: LineAround | null
  place: MarkPlace | null
  points: { at: Point; nearby: Reachable[]; offset: string }[]
  /** Whether bringing the mark into view scrolled the page or a frame. */
  scrolled: boolean
}

/** The hint shown now, if any: its box, its words and the hinted elements whose words it says. */
export interface Surface {
  box: Box
  /** The marks of the aimed chart drawn as pointed at, or null where none are told apart. */
  painted: string[] | null
  /** Where the aimed mark declares its hint stands, read as the hint shows. */
  place: MarkPlace | null
  /** Ids of the hinted elements whose words it is, or else whose words it holds. */
  says: string[]
  text: string
}

declare global {
  interface Window {
    sweepData: { hooks: readonly string[]; owners: typeof OWNERS; whole: string }
    sweepHelpers: typeof hintHelpers & typeof layoutHelpers
  }
}

function box(element: Element): Box {
  const rect = element.getBoundingClientRect()
  return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }
}

function middleOf(of: Box): Point {
  return { x: (of.left + of.right) / 2, y: (of.top + of.bottom) / 2 }
}

function classes(element: Element): string[] {
  return typeof element.className === 'string'
    ? element.className.split(/\s+/u).filter(Boolean)
    : []
}

/** Text with every run of space, of any width, taken out. */
function flat(text: string | null | undefined): string {
  return text ? text.replaceAll(/\s+/gu, '') : ''
}

/** One step of a selector path: the tag, a component's root class and a documented hook. */
function step(element: Element, own: boolean): string {
  const help = window.sweepHelpers
  const root = help
    .classes(element)
    .find((name) => window.sweepData.owners.some(([one]) => one === name))
  const named = root ?? (own ? help.classes(element)[0] : undefined)
  const hook = window.sweepData.hooks.find((name) => element.hasAttribute(name))
  const value = hook ? element.getAttribute(hook) : null
  const tag = element.tagName.toLowerCase()
  const dotted = named ? `.${named}` : ''
  return `${tag}${dotted}${hook ? help.hookText(hook, value) : ''}`
}

function hookText(hook: string, value: string | null): string {
  return value ? `[${hook}=${value}]` : `[${hook}]`
}

/** A selector path of the element: tags, root classes and documented hooks, never its words. */
function path(element: Element): string {
  const steps: string[] = []
  for (let at: Element | null = element; at && steps.length < 7; at = at.parentElement) {
    steps.unshift(window.sweepHelpers.step(at, at === element))
    if (window.sweepHelpers.classes(at).includes('analytics-page') || at === document.body) break
  }
  return steps.filter((one, index) => index === steps.length - 1 || /[.[]/u.test(one)).join(' > ')
}

/** The components an element stands in, innermost first, by their root classes. */
function owner(element: Element): string {
  const found: string[] = []
  for (let at: Element | null = element; at; at = at.parentElement) {
    const own = window.sweepData.owners.find(([root]) =>
      window.sweepHelpers.classes(at).includes(root),
    )
    if (own && !found.includes(own[1])) found.push(own[1])
  }
  return found.slice(0, 3).join(' < ')
}

function shown(element: Element): boolean {
  const rect = element.getBoundingClientRect()
  return (
    rect.width > 1 &&
    rect.height > 1 &&
    element.checkVisibility({ opacityProperty: true, visibilityProperty: true })
  )
}

/** Whether a box hides what overflows it, so its text can be cut. */
function hides(overflow: string): boolean {
  return overflow === 'hidden' || overflow === 'clip'
}

/** Cut as the hint system reads it: a box of it hides what overflows and holds more text. */
function cut(element: Element): boolean {
  return [element, ...[...element.querySelectorAll('*')].slice(0, 40)].some((one) => {
    if (!one.textContent?.trim() || one.classList.contains('visually-hidden')) return false
    const style = getComputedStyle(one)
    return (
      (window.sweepHelpers.hides(style.overflowX) && one.scrollWidth > one.clientWidth) ||
      (window.sweepHelpers.hides(style.overflowY) && one.scrollHeight > one.clientHeight + 1)
    )
  })
}

/**
 * Whether a hint the pointer could raise there shows: one of words the element shows is held back
 * until they are cut, a `clipped` one or a detail that says nothing the screen does not, since a
 * detail says only what the screen does not.
 */
function speaks(element: HTMLElement): boolean {
  const help = window.sweepHelpers
  if (!help.shown(element) && !element.querySelector('[data-hint-mark], [data-hint-point]'))
    return false
  const held =
    element.dataset.tooltipKind === 'clipped' ||
    help.flat(element.textContent).includes(help.flat(element.dataset.tooltip))
  return !held || help.cut(element)
}

/** Every element of `scope` (the page and its panel where null) with a hint that shows, each given a `data-sweep` id. */
function readHinted(scope: string | null): Hinted[] {
  const help = window.sweepHelpers
  for (const old of document.querySelectorAll<HTMLElement>('[data-sweep]')) delete old.dataset.sweep
  const marks = [
    'data-reading',
    'data-target',
    'data-sector',
    'data-series',
    'data-hint-mark',
    'data-hint-point',
  ]
  const found: Hinted[] = []
  for (const element of document.querySelectorAll<HTMLElement>('[data-tooltip]')) {
    if (!element.closest(scope ?? window.sweepData.whole) || !help.speaks(element)) continue
    const id = String(found.length + 1)
    element.dataset.sweep = id
    const kind = element.dataset.tooltipKind ?? 'detail'
    const sort = marks.filter((name) => element.matches(`[${name}], :has(> [${name}])`)).join(',')
    const who = help.owner(element)
    found.push({
      id,
      kind,
      owner: who,
      path: help.path(element),
      sort: `${who}|${element.tagName}|${sort}|${kind}`,
    })
  }
  return found
}

function nextFrame(): Promise<unknown> {
  return new Promise((done) => requestAnimationFrame(done))
}

/** Whether a point is on a drawn shape's fill; undefined for what is no drawn shape. */
function onFill(shape: Element, at: Point): boolean | undefined {
  if (!(shape instanceof SVGGeometryElement)) return undefined
  const matrix = shape.getScreenCTM()?.inverse()
  return matrix ? shape.isPointInFill(new DOMPoint(at.x, at.y).matrixTransform(matrix)) : undefined
}

/**
 * Whether a point is where a drawn shape takes the pointer: its fill or its stroke, painted or
 * not, as a ring's sector takes it over its half of the ground beside it; undefined for what is
 * no drawn shape.
 */
function onReach(shape: Element, at: Point): boolean | undefined {
  if (!(shape instanceof SVGGeometryElement)) return undefined
  const matrix = shape.getScreenCTM()?.inverse()
  if (!matrix) return undefined
  const local = new DOMPoint(at.x, at.y).matrixTransform(matrix)
  return shape.isPointInFill(local) || shape.isPointInStroke(local)
}

/**
 * Where a mark's hint stands, as the mark declares it now, and its centre: its point, its declared
 * box, or the element. A drawn shape's point is read again after the pointer came, since a ring's
 * sector names the point where the pointer stands on it, and it must stand on the shape itself.
 */
function markPlace(element: Element): { centre: Point; place: MarkPlace | null } {
  const help = window.sweepHelpers
  const declared = (
    element.matches('[data-hint-point]') ? element : element.querySelector('[data-hint-point]')
  ) as HTMLElement | SVGElement | null
  const named = declared?.dataset.hintPoint?.split(' ').map(Number)
  if (declared instanceof SVGGraphicsElement && named?.length === 2) {
    // A drawn shape names its point in its own units, as a ring's sector names its band's middle.
    const matrix = declared.ownerSVGElement?.getScreenCTM()
    const at = matrix
      ? new DOMPoint(named[0], named[1]).matrixTransform(matrix)
      : new DOMPoint(0, 0)
    return {
      centre: { x: at.x, y: at.y },
      place: {
        kind: 'point',
        box: { left: at.x, right: at.x, top: at.y, bottom: at.y },
        onShape: help.onFill(declared, at) !== false,
      },
    }
  }
  if (declared)
    return {
      centre: help.middleOf(help.box(declared)),
      place: { kind: 'point', box: help.box(declared) },
    }
  const boxed = element.matches('[data-hint-mark]')
    ? element
    : element.querySelector('[data-hint-mark]')
  const of = help.box(boxed ?? element)
  return { centre: help.middleOf(of), place: boxed ? { kind: 'box', box: of } : null }
}

/** The points along a ring's sector a quarter and three quarters round its stretch of the band. */
function alongBand(element: Element, centre: Point): [string, Point][] {
  if (!(element instanceof SVGGeometryElement) || !element.ownerSVGElement) return []
  const middle = window.sweepHelpers.middleOf(window.sweepHelpers.box(element.ownerSVGElement))
  const radius = Math.hypot(centre.x - middle.x, centre.y - middle.y)
  const held: Point[] = []
  for (let degree = 0; degree < 360; degree += 2) {
    const angle = (degree * Math.PI) / 180
    const at = { x: middle.x + radius * Math.sin(angle), y: middle.y - radius * Math.cos(angle) }
    if (window.sweepHelpers.onFill(element, at)) held.push(at)
  }
  if (held.length <= 8) return []
  return [
    ['band 1/4', held[Math.floor(held.length / 4)]],
    ['band 3/4', held[Math.floor((3 * held.length) / 4)]],
  ]
}

/** A step line's marks around `element`, where one layer picks among them, else null. */
function lineAround(element: Element): LineAround | null {
  const help = window.sweepHelpers
  const field = element.closest('[data-region="field"]')
  const layer = field?.querySelector('[data-hint-pick]')
  if (!field || !layer) return null
  return {
    // The layer runs half a mark past each edge of the field: the reach of a mark.
    reach: (layer.getBoundingClientRect().width - field.getBoundingClientRect().width) / 2,
    marks: [...field.querySelectorAll<HTMLElement>('[data-sweep]')].map((one) => ({
      id: one.dataset.sweep ?? '',
      place: Object.hasOwn(one.dataset, 'target'),
      x: help.middleOf(help.box(one.querySelector('[data-mark]') ?? one)).x,
    })),
  }
}

/**
 * Brings the mark `id` into view and reads where to point at it: its centre and `nudge` off it on
 * each axis, a sector also along its band, and at each point every hinted element near enough to
 * answer. The scroll is instant and read after the frame is drawn: read during a smooth scroll,
 * every box was where the content was passing through.
 */
async function readAround(id: string, nudge: number): Promise<MarkAround | null> {
  const help = window.sweepHelpers
  const element = document.querySelector<HTMLElement>(`[data-sweep="${id}"]`)
  if (!element) return null
  const before = element.getBoundingClientRect()
  element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' })
  await help.nextFrame()
  await help.nextFrame()
  const rect = element.getBoundingClientRect()
  const scrolled = rect.top !== before.top || rect.left !== before.left
  if (scrolled) await new Promise((done) => setTimeout(done, 150))
  const { centre: drawn, place } = help.markPlace(element)
  // A mark drawn with no height, as a period of nothing on its floor, has its centre on the edge
  // of what takes the pointer for it: aim just inside, where a reader's pointer is.
  const inside =
    element instanceof SVGElement || element.closest('[data-region="field"]:has([data-hint-pick])')
  const centre = inside
    ? drawn
    : {
        x: Math.min(Math.max(drawn.x, rect.left + 0.5), rect.right - 0.5),
        y: Math.min(Math.max(drawn.y, rect.top + 0.5), rect.bottom - 0.5),
      }
  const offsets: [string, Point][] = [
    ['0,0', centre],
    [`-${nudge},0`, { x: centre.x - nudge, y: centre.y }],
    [`${nudge},0`, { x: centre.x + nudge, y: centre.y }],
    [`0,-${nudge}`, { x: centre.x, y: centre.y - nudge }],
    [`0,${nudge}`, { x: centre.x, y: centre.y + nudge }],
    ...help.alongBand(element, centre),
  ]
  const all = [...document.querySelectorAll<HTMLElement>('[data-sweep]')]
  const points = offsets.map(([offset, at]) => ({
    offset,
    at,
    nearby: all
      .map((one) => ({
        id: one.dataset.sweep ?? '',
        box: help.box(one),
        onShape: help.onReach(one, at),
      }))
      .filter((one) => Math.abs(one.box.left - at.x) < 400 && Math.abs(one.box.top - at.y) < 400),
  }))
  return { place, points, line: help.lineAround(element), scrolled }
}

/** The marks of the chart around `element` painted as pointed at, or null where none are told apart. */
function paintedNear(element: Element | null): string[] | null {
  const field = element?.closest('[data-region="field"]')
  if (field) {
    const lit = [...field.querySelectorAll('[data-mark="place"], [data-mark="reading"]')].filter(
      (mark) => getComputedStyle(mark).opacity === '1',
    )
    // At rest every mark may be drawn; only a few lit marks tell the pointed one apart.
    return !lit.length || lit.length > 2
      ? null
      : lit.map((mark) => mark.closest<HTMLElement>('[data-sweep]')?.dataset.sweep ?? '?')
  }
  const ring = element?.closest('svg')
  return ring && element?.hasAttribute('data-sector')
    ? [...ring.querySelectorAll<HTMLElement>('[data-sector][data-lifted]')].map(
        (sector) => sector.dataset.sweep ?? '?',
      )
    : null
}

/** Reads the shown hint, and the marks of the chart around `aimed` painted as pointed at. */
function readSurface(aimed: string): Surface | null {
  const help = window.sweepHelpers
  const surface = [...document.querySelectorAll('[data-hint-surface]')].find(
    (one) => help.shown(one) && getComputedStyle(one).opacity !== '0',
  )
  if (!surface) return null
  const text = help.flat(surface.textContent)
  const marks = [...document.querySelectorAll<HTMLElement>('[data-sweep]')].map((one) => ({
    id: one.dataset.sweep ?? '',
    words: help.flat(one.dataset.tooltip),
    own: help.flat(one.textContent),
  }))
  const pointed = document.querySelector(`[data-sweep="${aimed}"]`)
  return {
    box: help.box(surface),
    text: (surface.textContent ?? '').replaceAll(/\s+/gu, ' ').trim(),
    says: help.hintSays(text, marks),
    painted: help.paintedNear(pointed),
    place: pointed ? help.markPlace(pointed).place : null,
  }
}

/** The helpers of this module, by name, as `window.sweepHelpers` holds them. */
const hintHelpers = {
  alongBand,
  box,
  classes,
  cut,
  flat,
  hides,
  hintSays,
  hookText,
  lineAround,
  markPlace,
  middleOf,
  nextFrame,
  onFill,
  onReach,
  owner,
  paintedNear,
  path,
  readAround,
  readHinted,
  readSurface,
  shown,
  speaks,
  step,
}

/** The script that installs the helpers above as `window.sweepHelpers` in every page of a context. */
export function helperScript(): string {
  const data = JSON.stringify({ owners: OWNERS, hooks: HOOKS, whole: WHOLE })
  const helpers = Object.entries({ ...hintHelpers, ...layoutHelpers }).map(
    ([name, helper]) => `${name}: ${helper.toString()}`,
  )
  return `window.sweepData = ${data};\nwindow.sweepHelpers = {\n${helpers.join(',\n')}\n};`
}
