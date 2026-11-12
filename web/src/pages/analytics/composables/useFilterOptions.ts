/**
 * What the filter of one dimension offers, each choice under its name: «none» as the read admits
 * it — work on no task, a session's own run, a value nobody can place — except for the role, which
 * every stretch has; the values that spent anything in the period; and a value chosen that the
 * period did not spend, as one a pasted link names, under its id. The field that chooses and the
 * chip that shows a choice name a value from this one list, so the two never call it differently;
 * the field says under a choice what its name leaves out (`valueDetail`), so two sessions of one
 * title or an account named by the owner can be told apart where they are chosen.
 */
import { useSpendingWords } from '@/pages/analytics/composables/useSpendingWords.ts'
import type { FilterValues } from '@/pages/analytics/composables/useUsageRead.ts'
import { filterKey, filterValue, valueKey } from '@/pages/analytics/utils/usageValues.ts'

import type { UsageDimension } from '@/shared/api/analyticsApi.ts'
import type { ChoiceOption } from '@/shared/ui/choiceControls.ts'

export function useFilterOptions() {
  const words = useSpendingWords()

  /** The choices of a dimension's filter, from what the period offers and the keys chosen. */
  function options(
    dimension: UsageDimension,
    read: FilterValues | undefined,
    chosen: readonly string[],
  ): ChoiceOption[] {
    const found = Array.isArray(read)
      ? read.flatMap((row) => {
          const value = row.group[dimension]
          return !value || value.id === null
            ? []
            : [
                {
                  value: valueKey(value),
                  label: words.valueLabel(dimension, value),
                  description: words.valueDetail(dimension, value),
                },
              ]
        })
      : []
    const none = words.noneLabel(dimension)
    const offered = [...(none === null ? [] : [{ value: filterKey(null), label: none }]), ...found]
    const known = new Set(offered.map((option) => option.value))
    const kept = chosen
      .filter((key) => !known.has(key))
      .map((key) => ({ value: key, label: filterValue(key) ?? key }))
    return [...offered, ...kept]
  }

  return { options }
}
