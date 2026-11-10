/**
 * What a value of a dimension is to the page: a category with its id, work with no value there
 * («no task»), or a value the store does not hold («unknown»). The two that are not categories
 * are never one row, and neither is ever merged into a category or into the folded tail.
 *
 * A key names a value everywhere on the page — a bar, a stack, a filter's choice — and no id
 * can be mistaken for one of the two: a category's key is its id behind a prefix.
 */
import type { UsageGroupValue } from '@/shared/api/analyticsApi.ts'

export type ValueKind = 'category' | 'none' | 'unknown'

export function valueKind(value: UsageGroupValue): ValueKind {
  if (value.unknown) return 'unknown'
  return value.id === null ? 'none' : 'category'
}

const CATEGORY = 'v:'

/** The key of a filter's value; null is the filter's «none», which admits both. */
export const filterKey = (value: string | null) => (value === null ? 'none' : `${CATEGORY}${value}`)

/** The filter's value of a key; null for «none». */
export const filterValue = (key: string) =>
  key.startsWith(CATEGORY) ? key.slice(CATEGORY.length) : null

/** The key of a value as the read names it. */
export function valueKey(value: UsageGroupValue): string {
  const kind = valueKind(value)
  return kind === 'category' ? filterKey(value.id) : kind
}
