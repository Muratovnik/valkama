/**
 * What the Analytics page shows, as its address holds it: the period, the section of the page on
 * show — the overview or the dimension the charts break work down by — the measure they draw, a
 * filter per dimension, whether a narrow screen shows that section in place of the list of
 * sections, and the second dimension a section's table is crossed with. A reload or a pasted link reads the same view back; a part the address does not hold
 * is the default, and a part it holds that this build cannot read is dropped rather than refusing
 * the whole link.
 *
 * The section is written under `by`, the key that held the breakdown before the page had
 * sections, so an address written then opens the section of its breakdown. The overview is the
 * one section that is no dimension, and it is written like any other.
 *
 * A preset is kept as its name, not as its dates: «this week» in a link opened next week is
 * next week's week, as the words say.
 *
 * The one reader and the one writer of that address. The page reads its view here and writes
 * every change here; a way to the page from elsewhere, such as an item's Agents tab, writes its
 * link here too, so a link says what the page will read.
 */
import { isUsageDimension, USAGE_DIMENSIONS } from '@/shared/api/analyticsApi.ts'
import type { UsageDimension, UsageFilters } from '@/shared/api/analyticsApi.ts'
import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

export const PERIODS = ['week', 'weeks4', 'custom'] as const
export type PeriodPreset = (typeof PERIODS)[number]

export const MEASURES = ['time', 'tokens', 'cost'] as const
export type Measure = (typeof MEASURES)[number]

/** The section of the page that is no dimension: the period's figures and its days. */
export const OVERVIEW = 'overview'

/** A section of the page: the overview, or a dimension the charts break work down by. */
export type AnalyticsSection = UsageDimension | typeof OVERVIEW

export interface AnalyticsView {
  /** The second dimension a section's table crosses its own with; null for none. */
  across: UsageDimension | null
  /** The section on show: the overview, or the dimension the bars and the stacks break work down by. */
  by: AnalyticsSection
  filters: UsageFilters
  /** The first and last day of a custom period, both included: `2030-03-04`. Empty otherwise. */
  from: string
  measure: Measure
  /** Whether a screen too narrow for the list of sections beside a section shows the section. */
  open: boolean
  period: PeriodPreset
  to: string
}

/**
 * The dimension a plain address breaks work down by. It stays a dimension, not the overview:
 * the plain address is also what the page wrote for its breakdown by task before it had sections.
 */
const DEFAULT_BREAKDOWN: UsageDimension = 'work_item'

export const DEFAULT_VIEW: AnalyticsView = {
  period: 'week',
  from: '',
  to: '',
  by: DEFAULT_BREAKDOWN,
  measure: 'time',
  filters: {},
  open: false,
  across: null,
}

const isSection = (value: unknown): value is AnalyticsSection =>
  value === OVERVIEW || isUsageDimension(value)

/** The dimension a view's reads break work down by: its section's, or the default for the overview. */
export const breakdownOf = (view: AnalyticsView): UsageDimension =>
  view.by === OVERVIEW ? DEFAULT_BREAKDOWN : view.by

type RouteState = Readonly<Record<string, string | number | boolean>>

/** How the address says a narrow screen shows the section rather than the list of sections. */
const OPEN = 'section'

const DATE = /^\d{4}-\d{2}-\d{2}$/u

const pad = (value: number) => String(value).padStart(2, '0')

/** A day as the browser's calendar names it and a custom period holds it: `2030-03-04`. */
export const localDay = (day: Date) =>
  `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`

const oneOf = <T extends string>(values: readonly T[], value: unknown, fallback: T): T =>
  values.includes(value as T) ? (value as T) : fallback

/** The filters a link holds, each dimension once and in the list's order, nothing empty. */
function readFilters(text: unknown): UsageFilters {
  if (typeof text !== 'string' || !text) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return {}
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
  const filters: UsageFilters = {}
  for (const [dimension, values] of Object.entries(parsed)) {
    if (!isUsageDimension(dimension) || !Array.isArray(values)) continue
    const admitted = values.filter(
      (value): value is string | null =>
        value === null || (typeof value === 'string' && Boolean(value)),
    )
    if (admitted.length) filters[dimension] = [...new Set(admitted)]
  }
  return orderFilters(filters)
}

/** The ids by their code points, then «none»: an order that does not depend on the locale. */
function byValue(left: string | null, right: string | null) {
  if (left === right) return 0
  if (left === null) return 1
  if (right === null) return -1
  return left < right ? -1 : 1
}

/**
 * The filters in the dimensions' order and each filter's values in one order, whatever order
 * they were chosen in, so one view has one address.
 */
export function orderFilters(filters: UsageFilters): UsageFilters {
  const ordered: UsageFilters = {}
  for (const dimension of USAGE_DIMENSIONS) {
    const values = filters[dimension]
    if (values?.length) ordered[dimension] = [...values].sort(byValue)
  }
  return ordered
}

/** The view an address holds, with the default for every part it does not. */
export function readAddress(state: RouteState | undefined): AnalyticsView {
  const period = oneOf(PERIODS, state?.period, DEFAULT_VIEW.period)
  const custom = period === 'custom'
  const date = (value: unknown) =>
    custom && typeof value === 'string' && DATE.test(value) ? value : ''
  return {
    period,
    from: date(state?.from),
    to: date(state?.to),
    by: isSection(state?.by) ? state.by : DEFAULT_VIEW.by,
    measure: oneOf(MEASURES, state?.measure, DEFAULT_VIEW.measure),
    filters: readFilters(state?.filters),
    open: state?.open === OPEN,
    across: isUsageDimension(state?.across) ? state.across : null,
  }
}

/** The address of a view: only what differs from the default, so the plain page is plain. */
export function writeAddress(view: AnalyticsView): Record<string, string> {
  const state: Record<string, string> = {}
  if (view.period !== DEFAULT_VIEW.period) state.period = view.period
  if (view.period === 'custom') {
    if (view.from) state.from = view.from
    if (view.to) state.to = view.to
  }
  if (view.by !== DEFAULT_VIEW.by) state.by = view.by
  if (view.measure !== DEFAULT_VIEW.measure) state.measure = view.measure
  const filters = orderFilters(view.filters)
  if (Object.keys(filters).length) state.filters = JSON.stringify(filters)
  if (view.open) state.open = OPEN
  if (view.across) state.across = view.across
  return state
}

/**
 * The Analytics page showing a view, as a link: global, since work is counted to an item
 * whichever project the page would otherwise be scoped to. It throws for a view whose address
 * the route refuses; `addressFits` says which those are.
 */
export function analyticsPageAddress(view: AnalyticsView): string {
  return serializePlatformRoute({
    module_id: 'analytics',
    scope: { kind: 'global' },
    state: writeAddress(view),
  })
}

/**
 * Whether a view's address can be written: every part within what the route holds, as the
 * route's own check decides. A filter of many values is one string, and past that check a
 * navigation to it would fail.
 */
export function addressFits(view: AnalyticsView): boolean {
  try {
    analyticsPageAddress(view)
    return true
  } catch {
    return false
  }
}
