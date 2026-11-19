/**
 * What the Work filter is over, as the shared filter field reads it (`FacetSource`), and what a
 * picked token is called.
 *
 * The values come from the work the bar counts — the labels and holders that
 * are actually there, the states the workflow has — so the menu never offers
 * a value that matches nothing it could show. Kind and priority are closed
 * vocabularies and are offered whole.
 */
import { choiceMark } from '@/entities/work-item/utils/facetChoices.ts'
import type { FacetMark } from '@/entities/work-item/utils/facets.ts'
import {
  filterTokens,
  hasToken,
  WORK_FILTER_CONDITIONS,
} from '@/entities/work-item/utils/workFilter.ts'
import type {
  LabelsMatch,
  ValueToken,
  WorkFilter,
  WorkFilterToken,
} from '@/entities/work-item/utils/workFilter.ts'

import { PRIORITIES, WORK_ITEM_KINDS } from '@/shared/api/planningModel.ts'
import type { WorkItemBrief } from '@/shared/api/planningModel.ts'
import { actorName } from '@/shared/lib/actor.ts'
import { byUse } from '@/shared/lib/byUse.ts'
import type { OptionRow } from '@/shared/ui/choiceControls.ts'
import type { FacetChoice, FacetSource } from '@/shared/ui/facetMenu.ts'

type Translate = (key: string, params?: Record<string, unknown>) => string
type StateCategory = WorkItemBrief['state']['category']
type ValueFacet = Exclude<WorkFilterToken['facet'], 'ready' | 'held'>

/**
 * The menu's facets, in the order a reader narrows by them: the closed vocabularies every space
 * has, then who holds the work, then the labels, the longest list and the one whose head offers a
 * choice. Where text finds values of several facets at once, that head waits at the menu's lower
 * edge until the list reaches it (`OptionGroups`), so how labels combine stays in sight.
 */
const GROUP_ORDER: readonly ValueFacet[] = ['category', 'kind', 'priority', 'holder', 'labels']

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

/** What a chip says: «Метка: coordinator», «Метка: не coordinator»; a condition by its own name. */
export function tokenName(token: WorkFilterToken, t: Translate): string {
  if (token.facet === 'ready' || token.facet === 'held') return tokenValue(token, t)
  return t(token.not ? 'workItem.filter.chipNot' : 'workItem.filter.chip', {
    facet: t(`workItem.filter.facet.${token.facet}`),
    value: tokenValue(token, t),
  })
}

/**
 * A token's key, the same whether it is negated or not: a value is in the filter
 * one way at most, and the chip that switches it keeps its place and its focus.
 */
export function tokenKey(token: WorkFilterToken): string {
  return 'value' in token ? `${token.facet}:${token.value}` : token.facet
}

const LABELS_MATCHES: readonly LabelsMatch[] = ['all', 'any']

/**
 * How the labels picked can combine, offered in the head of their group as soon as there are two
 * labels to combine, whichever are picked.
 */
function labelsChoices(t: Translate, chosen: LabelsMatch): FacetChoice[] {
  return LABELS_MATCHES.map((match) => ({
    key: labelsMatchKey(match),
    name: t(`workItem.filter.labelsMatch.${match}.name`),
    text: t(`workItem.filter.labelsMatch.${match}.text`),
    title: t(`workItem.filter.labelsMatch.${match}.title`),
    selected: chosen === match,
  }))
}

/** The key of a way the labels combine, in the head of their group. */
const labelsMatchKey = (match: LabelsMatch) => `labelsMatch:${match}`

/** The way the labels combine a choice's key names; undefined for a key of none. */
export const labelsMatchOf = (key: string) =>
  LABELS_MATCHES.find((match) => labelsMatchKey(match) === key)

function facetValues(
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

/** A value of a closed vocabulary as the registry draws it; a label or a holder has no mark. */
function markOf(token: WorkFilterToken, text: string): FacetMark | undefined {
  if (token.facet === 'kind' || token.facet === 'priority') return choiceMark(token)
  if (token.facet === 'category')
    return choiceMark({
      facet: 'state',
      value: token.value,
      state: { name: text, category: token.value },
    })
  return undefined
}

/** A value row of the Work filter's menu: a kind's, a priority's or a state's mark beside its word. */
export type WorkFilterRow = OptionRow & {
  /**
   * How a kind, a priority or a state is drawn, glyph and word, as the card draws it; the other
   * facets' values are their words alone.
   */
  mark?: FacetMark
}

/** The token a row stands for, by the key `tokenKey` gave it; undefined for a key of no token. */
export function tokenOfKey(key: string, facet: string | null): WorkFilterToken | undefined {
  if (facet === null) return WORK_FILTER_CONDITIONS.find((token) => tokenKey(token) === key)
  const value = key.slice(facet.length + 1)
  return (GROUP_ORDER as readonly string[]).includes(facet)
    ? ({ facet, value } as WorkFilterToken)
    : undefined
}

/** A value's row as the menu draws it: its word, its mark, and whether it is in, either way. */
function valueRow(token: WorkFilterToken, filter: WorkFilter, t: Translate): WorkFilterRow {
  const text = tokenValue(token, t)
  const mark = markOf(token, text)
  // A value the work must not carry is in the filter too, marked as the chip's cross is.
  const negated = 'value' in token && hasToken(filter, { ...token, not: true } as ValueToken)
  return {
    key: tokenKey(token),
    text,
    ...(mark ? { mark } : {}),
    ...(negated ? { name: t('workItem.filter.excluded', { value: text }), icon: 'close' } : {}),
    selected: negated || hasToken(filter, token),
  }
}

/**
 * What the Work filter is over (`FacetSource`): the conditions first, then the facets that have a
 * value to offer, each read only when the menu shows it. A value already in the filter stays
 * offered, so picking it again is how it comes out, and so does one the work no longer carries.
 * A space's labels made the menu a list of some two thousand nodes that the board built, out of
 * sight, before its first tile could show; the field builds it when it opens instead, and then
 * only for the step on show.
 */
export function workFilterSource(input: {
  t: Translate
  categories: () => readonly StateCategory[]
  filter: () => WorkFilter
  /** How many open items are held: the held condition's count; none while it is unknown. */
  held: () => number | null
  items: () => readonly WorkItemBrief[]
}): FacetSource<WorkFilterRow> {
  const { t } = input
  const valuesOf = (facet: ValueFacet) => {
    const values = facetValues(facet, input.items(), input.categories())
    for (const token of filterTokens(input.filter()))
      if (token.facet === facet && !values.includes(token.value)) values.push(token.value)
    return values
  }
  return {
    conditions: () => ({
      name: t('workItem.filter.conditions'),
      rows: WORK_FILTER_CONDITIONS.map((token) => {
        const held = input.held()
        return {
          ...valueRow(token, input.filter(), t),
          ...(token.facet === 'held' && held !== null ? { detail: String(held) } : {}),
        }
      }),
    }),
    facets: () =>
      GROUP_ORDER.filter((facet) => valuesOf(facet).length).map((facet) => ({
        id: facet,
        name: t(`workItem.filter.facet.${facet}`),
      })),
    values: (facet) => {
      const values = valuesOf(facet as ValueFacet)
      const filter = input.filter()
      return {
        rows: values.map((value) => valueRow({ facet, value } as WorkFilterToken, filter, t)),
        ...(facet === 'labels' && values.length > 1
          ? { choices: labelsChoices(t, filter.labelsMatch ?? 'all') }
          : {}),
      }
    },
  }
}
