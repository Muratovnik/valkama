/**
 * The list's order: the column it is sorted by and which way, and the rows in
 * that order. One click on a column sorts by it; a second turns it over.
 */
import { computed, ref } from 'vue'

import { sortedRows } from '@/widgets/work-item-views/utils/listColumns.ts'
import type { SortKey } from '@/widgets/work-item-views/utils/listColumns.ts'

import type { WorkItemBrief } from '@/shared/api/planningModel.ts'

export function useListSort(items: () => readonly WorkItemBrief[]) {
  const sortKey = ref<SortKey>('updated')
  const descending = ref(true)

  function sortBy(key: SortKey) {
    if (sortKey.value === key) descending.value = !descending.value
    else {
      sortKey.value = key
      // The columns people scan for "what changed" and "what is urgent" read
      // newest and highest first; a name reads A to Z.
      descending.value = key === 'updated' || key === 'priority' || key === 'checklist'
    }
  }

  function ariaSort(key: SortKey): 'ascending' | 'descending' | 'none' {
    if (sortKey.value !== key) return 'none'
    return descending.value ? 'descending' : 'ascending'
  }

  return {
    ariaSort,
    descending,
    rows: computed(() => sortedRows(items(), sortKey.value, descending.value)),
    sortBy,
    sortKey,
  }
}
