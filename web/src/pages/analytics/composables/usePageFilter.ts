/**
 * The page's filters as every part of the Analytics page changes them: a dimension's filter set
 * to the values its field holds (`set`), and one value added to the values already there (`add`),
 * which is what choosing a value in that field does. A value's side panel and an account of the
 * quota add theirs through the same operation, so a value added from anywhere joins the filter
 * beside its other values — A, B and then C is A, B, C — and the page stays on its section.
 *
 * The filters are part of the view's address, so a change the address cannot hold is not made:
 * `add` answers `full` and `set` false, with nothing written. Where it was asked in place, under
 * the page, the page says why under its filters (`full`), as for the field; the side panel stands
 * over the filters and says it itself.
 */
import { inject, provide } from 'vue'
import type { InjectionKey } from 'vue'

import { orderFilters } from '@/shared/api/analyticsAddress.ts'
import type { AnalyticsView } from '@/shared/api/analyticsAddress.ts'
import type { UsageDimension, UsageFilters } from '@/shared/api/analyticsApi.ts'

/** What adding a value came to: added, there already, or more than the address holds. */
type FilterAdding = 'added' | 'present' | 'full'

/** Whether a dimension's filter holds the value; `null` is work with no value there. */
const holds = (filters: UsageFilters, dimension: UsageDimension, value: string | null) =>
  (filters[dimension] ?? []).includes(value)

/** The filters with the value added to its dimension's, in the address's order; null if held. */
function withValue(
  filters: UsageFilters,
  dimension: UsageDimension,
  value: string | null,
): UsageFilters | null {
  return holds(filters, dimension, value)
    ? null
    : orderFilters({ ...filters, [dimension]: [...(filters[dimension] ?? []), value] })
}

type PageFilter = ReturnType<typeof createPageFilter>

const PAGE_FILTER: InjectionKey<PageFilter> = Symbol('analytics-page-filter')

function createPageFilter(options: {
  /** Writes a change of the view into its address; false, with nothing written, if it does not fit. */
  change: (next: Partial<AnalyticsView>, mode: 'push' | 'replace') => boolean
  /** Says under the filters that a dimension's filter cannot hold one more value. */
  full: (dimension: UsageDimension) => void
  view: () => AnalyticsView
}) {
  const filters = () => options.view().filters

  /** Whether the page's filter of a dimension holds the value already. */
  const has = (dimension: UsageDimension, value: string | null) =>
    holds(filters(), dimension, value)

  /** A dimension's filter set to these values, a change in place; false where it does not fit. */
  function set(dimension: UsageDimension, values: (string | null)[]) {
    const changed = options.change(
      { filters: orderFilters({ ...filters(), [dimension]: values }) },
      'replace',
    )
    if (!changed) options.full(dimension)
    return changed
  }

  /**
   * The value added to its dimension's filter, the filter's other values and the section kept. In
   * place it is a change of the place in hand and a refusal is said under the filters; `closing`
   * the side panel it was asked in, it is a new place with the panel closed, and the panel says a
   * refusal itself.
   */
  function add(dimension: UsageDimension, value: string | null, closing = false): FilterAdding {
    const next = withValue(filters(), dimension, value)
    if (!next) return 'present'
    const added = closing
      ? options.change({ filters: next, detail: null }, 'push')
      : options.change({ filters: next }, 'replace')
    if (added) return 'added'
    if (!closing) options.full(dimension)
    return 'full'
  }

  return { add, has, set }
}

/** The page's filter operations, given to every part under it. */
export function providePageFilter(options: Parameters<typeof createPageFilter>[0]) {
  const filter = createPageFilter(options)
  provide(PAGE_FILTER, filter)
  return filter
}

/** The page's filter operations; none outside the page, where nothing offers to add a value. */
export const usePageFilter = () => inject(PAGE_FILTER, null)
