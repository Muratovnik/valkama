import { computed, onScopeDispose, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'

import { searchGlobalPlanningWorkItems } from '@/shared/api/planningGlobalSearchApi.ts'
import type { PlanningSpaceRef } from '@/shared/api/platformPlanningRefs.ts'
import type { ChoiceOption } from '@/shared/ui/choiceControls.ts'

/** How long typing rests before the words are searched. */
const PAUSE = 200

/** Where the cards are found: the space they stand in, and the card that waits, which is left out. */
export interface CardSearchScope {
  /** The work item id of the card that would wait on the one found. */
  own: string
  space: PlanningSpaceRef | undefined
}

/**
 * The cards work can be put off until the close of: the open ones of its own space, found by
 * what is typed, and never the card itself, which putting off cannot wait on. The server refuses
 * the rest it cannot wait on, an ancestor among them, and says so where the write was made.
 *
 * Nothing is offered before something is typed: a space's open work runs to hundreds of cards.
 * The card chosen stays among the options while other words are searched, so the field keeps
 * naming it.
 */
export function useCardSearch(scope: () => CardSearchScope) {
  const { t } = useI18n()
  const query = shallowRef('')
  const found = shallowRef<ChoiceOption[]>([])
  const kept = shallowRef<ChoiceOption | null>(null)
  let timer: ReturnType<typeof setTimeout> | undefined
  let controller: AbortController | null = null

  function stop() {
    clearTimeout(timer)
    controller?.abort()
    controller = null
  }
  onScopeDispose(stop)

  async function run(words: string) {
    const current = new AbortController()
    controller = current
    const { own, space } = scope()
    try {
      const result = await searchGlobalPlanningWorkItems(words, current.signal)
      if (controller !== current) return
      found.value = result.items
        .filter(
          ({ target: other, item }) =>
            other.space_ref.data_scope_id === space?.data_scope_id &&
            other.space_ref.space_key === space.space_key &&
            item.open &&
            item.work_item_id !== own,
        )
        .map(({ item }) => ({ value: item.reference, label: `${item.reference} ${item.title}` }))
    } catch {
      if (controller === current) found.value = []
    }
  }

  /** Searches what is typed once typing rests; nothing typed offers nothing. */
  function search(words: string) {
    stop()
    query.value = words.trim()
    if (!query.value) {
      found.value = []
      return
    }
    timer = setTimeout(() => void run(query.value), PAUSE)
  }

  const options = computed(() =>
    kept.value && !found.value.some((option) => option.value === kept.value?.value)
      ? [kept.value, ...found.value]
      : found.value,
  )
  /** Remembers the card chosen, so the field keeps its words whatever is searched next. */
  function choose(reference: string) {
    kept.value = options.value.find((option) => option.value === reference) ?? null
  }
  const emptyLabel = computed(() =>
    t(query.value ? 'requests.kinds.noCards' : 'requests.kinds.cardHint'),
  )
  return { choose, emptyLabel, options, search }
}
