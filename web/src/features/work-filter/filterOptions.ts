/**
 * What the «Фильтр» menu offers and what a picked token is called.
 *
 * The values come from the work the bar counts — the labels and holders that
 * are actually there, the states the workflow has — so the menu never offers
 * a value that matches nothing it could show. Kind and priority are closed
 * vocabularies and are offered whole.
 */
import {
  filterTokens,
  hasToken,
  WORK_FILTER_PRESETS,
} from '@/entities/work-item/utils/workFilter.ts'
import type { WorkFilter, WorkFilterToken } from '@/entities/work-item/utils/workFilter.ts'

import { PRIORITIES, WORK_ITEM_KINDS } from '@/shared/api/planningModel.ts'
import type { WorkItemBrief } from '@/shared/api/planningModel.ts'
import { actorName } from '@/shared/lib/actor.ts'

type Translate = (key: string, params?: Record<string, unknown>) => string
type StateCategory = WorkItemBrief['state']['category']
type ValueFacet = Exclude<WorkFilterToken['facet'], 'ready' | 'held'>

type FilterGroupId = 'presets' | ValueFacet

export interface FilterOption {
  /** Unique across the menu, and stable while the value is offered. */
  key: string
  /** The value's own word: «Высокий», `coordinator`, «Назначено». */
  text: string
  token: WorkFilterToken
  /** A count beside the word, where one says something: how many are held. */
  detail?: string
}

export interface FilterGroup {
  id: FilterGroupId
  name: string
  options: FilterOption[]
}

/** The menu's facets, in the order a reader narrows by them. */
const GROUP_ORDER: readonly ValueFacet[] = ['category', 'kind', 'priority', 'labels', 'holder']

/** The word for a token's value, in the reader's language. */
function tokenValue(token: WorkFilterToken, t: Translate): string {
  switch (token.facet) {
    case 'ready':
    case 'held': {
      return t(`workItem.facet.${token.facet}`)
    }
    case 'category': {
      return t(`workItem.category.${token.value}`)
    }
    case 'kind': {
      return t(`workItem.kind.${token.value}`)
    }
    case 'priority': {
      return t(`priority.${token.value}`)
    }
    default: {
      return token.value
    }
  }
}

/** What a chip says: «Метка: coordinator»; a preset by its own name. */
export function tokenName(token: WorkFilterToken, t: Translate): string {
  if (token.facet === 'ready' || token.facet === 'held') return tokenValue(token, t)
  return t('workItem.filter.chip', {
    facet: t(`workItem.filter.facet.${token.facet}`),
    value: tokenValue(token, t),
  })
}

export function tokenKey(token: WorkFilterToken): string {
  return 'value' in token ? `${token.facet}:${token.value}` : token.facet
}

/** Values by how many items carry them, then by name: the common ones first. */
function byUse(values: readonly string[]): string[] {
  const counts = new Map<string, number>()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  return [...counts.keys()].sort(
    (left, right) =>
      (counts.get(right) ?? 0) - (counts.get(left) ?? 0) || left.localeCompare(right),
  )
}

function valuesOf(
  facet: ValueFacet,
  items: readonly WorkItemBrief[],
  categories: readonly StateCategory[],
): string[] {
  switch (facet) {
    case 'category': {
      return [...new Set(categories)]
    }
    case 'kind': {
      return [...WORK_ITEM_KINDS]
    }
    case 'priority': {
      return [...PRIORITIES].reverse()
    }
    case 'labels': {
      return byUse(items.flatMap((item) => item.labels))
    }
    default: {
      return byUse(
        items
          .filter((item) => item.claim_ref !== '' && !item.state.is_terminal)
          .map((item) => actorName(item.claim_ref)),
      )
    }
  }
}

/**
 * Every group the menu offers, with the presets first. A value already in the
 * filter stays offered, so picking it again is how it comes out.
 */
export function filterGroups(input: {
  categories: readonly StateCategory[]
  /** Values in the filter that the work no longer carries stay removable here. */
  filter: WorkFilter
  /** How many open items are held: the «Назначено» preset's count. */
  held: number
  items: readonly WorkItemBrief[]
  t: Translate
}): FilterGroup[] {
  const { t } = input
  const presets: FilterGroup = {
    id: 'presets',
    name: t('workItem.filter.presets'),
    options: WORK_FILTER_PRESETS.map((preset) => {
      const token = preset.tokens[0] as WorkFilterToken
      return {
        key: tokenKey(token),
        token,
        text: t(preset.label),
        ...(token.facet === 'held' ? { detail: String(input.held) } : {}),
      }
    }),
  }
  const picked = filterTokens(input.filter)
  const groups = GROUP_ORDER.map((facet) => {
    const values = valuesOf(facet, input.items, input.categories)
    for (const token of picked)
      if (token.facet === facet && !values.includes(token.value)) values.push(token.value)
    return {
      id: facet,
      name: t(`workItem.filter.facet.${facet}`),
      options: values.map((value) => {
        const token = { facet, value } as WorkFilterToken
        return { key: tokenKey(token), token, text: tokenValue(token, t) }
      }),
    }
  })
  return [presets, ...groups].filter((group) => group.options.length)
}

/**
 * The groups narrowed to what the typed text names: a value whose word holds
 * it, or every value of a facet whose name does («приор» offers the
 * priorities).
 */
export function narrowGroups(groups: readonly FilterGroup[], text: string): FilterGroup[] {
  const needle = text.trim().toLocaleLowerCase()
  if (!needle) return [...groups]
  return groups
    .map((group) =>
      group.name.toLocaleLowerCase().includes(needle)
        ? group
        : {
            ...group,
            options: group.options.filter((option) =>
              option.text.toLocaleLowerCase().includes(needle),
            ),
          },
    )
    .filter((group) => group.options.length)
}

/** Whether a token is in the filter, as an option reads it. */
export const picked = (filter: WorkFilter, option: FilterOption) => hasToken(filter, option.token)
