/**
 * The Work filter on the shared filter field and chips (`FacetFilter`, `FacetFilterChips`): what
 * the field is over (`workFilterSource`), its words, and what a pick, a choice or a chip taken out
 * does to the one model, `WorkFilter`.
 *
 * Two ways in, one model out. A chip clicked on a tile and a value picked from the menu produce
 * the same `WorkFilterToken`, so a filter reads the same whichever way it was built, and the
 * chips that show it are how it is taken apart again.
 *
 * The text is the filter's own, narrowing the work by reference and title as it narrows the
 * menu, and the menu's last row hands it to the search over every project, the one thing this
 * filter cannot do. The menu opens on the conditions «Workable» and «Has an assignee» over the
 * facets, and the labels' head says how the labels picked combine.
 *
 * A facet's value chip has the operator before it, «=» or, pressed, «≠», which turns the value
 * into one the work must not carry; a condition is no value and has none. The labels say how they
 * combine in the word between two of them; a label negated is kept out whatever «any» lets in, so
 * the word before it is always «and».
 */
import { computed } from 'vue'
import type { Ref } from 'vue'
import { useI18n } from 'vue-i18n'

import {
  labelsMatchOf,
  tokenKey,
  tokenName,
  tokenOfKey,
  workFilterSource,
} from '@/features/work-filter/filterOptions.ts'

import {
  filterTokens,
  negateToken,
  removeToken,
  setLabelsMatch,
  toggleToken,
} from '@/entities/work-item/utils/workFilter.ts'
import type {
  ValueToken,
  WorkFilter,
  WorkFilterToken,
} from '@/entities/work-item/utils/workFilter.ts'

import type { WorkItemBrief } from '@/shared/api/planningModel.ts'
import type { FacetChip } from '@/shared/ui/FacetFilterChips.vue'

export function useWorkFilter(input: {
  filter: Ref<WorkFilter>
  /** The states the workflow has, by category: what the state facet offers. */
  categories: () => readonly WorkItemBrief['state']['category'][]
  /** Open items somebody holds: the held condition's count; none while it is unknown. */
  held: () => number | null
  /** The work the bar counts, whose labels and holders the menu offers. */
  items: () => readonly WorkItemBrief[]
}) {
  const { t } = useI18n()
  const { filter } = input
  const tokens = computed(() => filterTokens(filter.value))

  const source = workFilterSource({ ...input, filter: () => filter.value, t })

  /** What the field and its menu say of themselves. */
  const field = computed(() => ({
    clearLabel: t('workItem.filter.clearText'),
    label: t('workItem.filter.label'),
    menuLabel: t('workItem.filter.menuLabel'),
    placeholder: t('workItem.filter.placeholder'),
    shortPlaceholder: t('workItem.filter.placeholderShort'),
    words: {
      facets: t('workItem.filter.facets'),
      back: (facet: string) => t('workItem.filter.back', { facet }),
      find: {
        group: t('workItem.filter.everywhere.group'),
        row: (text: string) => t('workItem.filter.everywhere.row', { text }),
      },
    },
  }))

  const text = computed({
    get: () => filter.value.text,
    set: (next: string) => {
      filter.value = { ...filter.value, text: next }
    },
  })

  /** A value goes in, or out if it was in, with the text the pick leaves, in one change. */
  function pick(key: string, facet: string | null, left: string) {
    const token = tokenOfKey(key, facet)
    if (token) filter.value = { ...toggleToken(filter.value, token), text: left }
  }

  /** How the labels picked combine; the text stays. */
  function choose(key: string) {
    const match = labelsMatchOf(key)
    if (match) filter.value = setLabelsMatch(filter.value, match)
  }

  function remove(token: WorkFilterToken | undefined) {
    if (token) filter.value = removeToken(filter.value, token)
  }

  /** The operator before a value: pressed while it is negated, named for what it would switch. */
  function operatorOf(token: WorkFilterToken) {
    if (!('value' in token)) return {}
    const name = tokenName({ ...token, not: undefined } as ValueToken, t)
    return {
      operator: { pressed: token.not === true, name: t('workItem.filter.negate', { name }) },
    }
  }

  const chips = computed<FacetChip[]>(() => {
    const firstLabel = tokens.value.findIndex((token) => token.facet === 'labels')
    const word = t(`workItem.filter.labelsMatch.${filter.value.labelsMatch ?? 'all'}.join`)
    const and = t('workItem.filter.labelsMatch.all.join')
    return tokens.value.map((token, index) => {
      const name = tokenName(token, t)
      const label = token.facet === 'labels' && index > firstLabel
      return {
        key: tokenKey(token),
        name,
        removeName: t('workItem.filter.remove', { name }),
        ...(label ? { join: token.not ? and : word } : {}),
        ...operatorOf(token),
      }
    })
  })

  const tokenOf = (key: string) => tokens.value.find((token) => tokenKey(token) === key)

  return {
    chips,
    choose,
    field,
    pick,
    source,
    text,
    /** How many chips show the filter. */
    count: computed(() => tokens.value.length),
    /** «Is not» switched on a chip: the value moves to the other list. */
    negate(key: string) {
      const token = tokenOf(key)
      if (token && 'value' in token) filter.value = negateToken(filter.value, token)
    },
    remove: (key: string) => remove(tokenOf(key)),
    removeLast: () => remove(tokens.value.at(-1)),
  }
}
