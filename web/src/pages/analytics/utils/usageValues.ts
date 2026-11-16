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

/**
 * Work on items naming several projects: no category and no filter's value, as work naming none
 * is, and still a row of its own apart from that.
 */
export const isSeveral = (value: UsageGroupValue) => Array.isArray(value.combinations)

/** The key of a value as the read names it. */
export function valueKey(value: UsageGroupValue): string {
  const kind = valueKind(value)
  if (kind === 'category') return filterKey(value.id)
  return kind === 'none' && isSeveral(value) ? 'several' : kind
}

/**
 * The key of a pair, a value of the section's dimension with one of the dimension it is split by:
 * both keys, in that order, as one text no single value's key can be, whatever an id holds.
 */
export const pairKey = (first: UsageGroupValue, second: UsageGroupValue) =>
  JSON.stringify([valueKey(first), valueKey(second)])

/**
 * What a pair is to the page: a category while both its values are, and otherwise what the first
 * value that is not one is — «claude-opus-5-5 · unknown» is work nobody can place by its effort,
 * drawn in the neutral as unknown work is.
 */
export function pairKind(first: UsageGroupValue, second: UsageGroupValue): ValueKind {
  const kind = valueKind(first)
  return kind === 'category' ? valueKind(second) : kind
}
