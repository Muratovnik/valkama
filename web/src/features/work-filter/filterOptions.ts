/**
 * What the filter's menu offers at each of its two steps and what a picked
 * token is called.
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
  WorkFilter,
  WorkFilterToken,
} from '@/entities/work-item/utils/workFilter.ts'

import { PRIORITIES, WORK_ITEM_KINDS } from '@/shared/api/planningModel.ts'
import type { WorkItemBrief } from '@/shared/api/planningModel.ts'
import { actorName } from '@/shared/lib/actor.ts'
import { byUse } from '@/shared/lib/byUse.ts'

type Translate = (key: string, params?: Record<string, unknown>) => string
type StateCategory = WorkItemBrief['state']['category']
type ValueFacet = Exclude<WorkFilterToken['facet'], 'ready' | 'held'>

type FilterGroupId = 'conditions' | 'facets' | 'everywhere' | ValueFacet

/**
 * Where the menu stands: the list of facets, with the conditions over it, or one
 * facet's values. A reader picks the facet first, as Linear and GitLab ask,
 * because every value of every facet at once was a list a space's labels made
 * thousands long.
 */
export type FilterStep = 'facets' | ValueFacet

/** What a row does when it is taken. */
type FilterAction =
  /** The value goes into the filter, or out if it was in. */
  | { do: 'pick'; token: WorkFilterToken }
  /** The menu steps into the facet's values. */
  | { do: 'open'; facet: ValueFacet }
  /** The menu steps back to the facets. */
  | { do: 'back' }
  /** The text goes to the search over every project. */
  | { do: 'find' }

export interface FilterOption {
  action: FilterAction
  /** Unique across the menu, and stable while the value is offered. */
  key: string
  /** The value's own word: «Высокий», `coordinator`, «Есть исполнитель». */
  text: string
  /** A count beside the word, where one says something: how many are held. */
  detail?: string
  /**
   * How a kind, a priority or a state is drawn, glyph and word, as the card draws it; the
   * other facets' values are their words alone.
   */
  mark?: FacetMark
}

/** A value row, the one kind of row a facet's group holds. */
type ValueOption = FilterOption & { action: { do: 'pick' } }

/** A way the labels picked can combine, offered in the head of their group. */
interface FilterChoice {
  key: string
  match: LabelsMatch
  /** What a screen reader says of it, which the short word beside the group's name is not. */
  name: string
  text: string
  /** What it does, for the pointer resting on the short word. */
  title: string
}

export interface FilterGroup {
  id: FilterGroupId
  name: string
  options: FilterOption[]
  /** The group's name is the way back to the facets, the first row the arrows reach. */
  back?: FilterOption
  /** No head: its one row says what it is, and the name only labels it for a screen reader. */
  bare?: boolean
  /** Offered ahead of the values, and walked ahead of them. */
  choices?: FilterChoice[]
}

/** A group of values, as `filterGroups` makes them. */
type ValueGroup = Omit<FilterGroup, 'options'> & { options: ValueOption[] }

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

function labelsChoices(t: Translate): FilterChoice[] {
  return LABELS_MATCHES.map((match) => ({
    key: `labelsMatch:${match}`,
    match,
    name: t(`workItem.filter.labelsMatch.${match}.name`),
    text: t(`workItem.filter.labelsMatch.${match}.text`),
    title: t(`workItem.filter.labelsMatch.${match}.title`),
  }))
}

/** The choice is there as soon as there are two labels to combine, whichever are picked. */
const choicesOf = (facet: ValueFacet, values: readonly string[], t: Translate) =>
  facet === 'labels' && values.length > 1 ? { choices: labelsChoices(t) } : {}

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

const pick = (token: WorkFilterToken) => ({ do: 'pick', token }) as const

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

/**
 * Every group the menu offers, with the conditions first. A value already in the
 * filter stays offered, so picking it again is how it comes out.
 */
export function filterGroups(input: {
  categories: readonly StateCategory[]
  /** Values in the filter that the work no longer carries stay removable here. */
  filter: WorkFilter
  /** How many open items are held: the held condition's count; none while it is unknown. */
  held: number | null
  items: readonly WorkItemBrief[]
  t: Translate
}): ValueGroup[] {
  const { t } = input
  const conditions: ValueGroup = {
    id: 'conditions',
    name: t('workItem.filter.conditions'),
    options: WORK_FILTER_CONDITIONS.map((token) => ({
      key: tokenKey(token),
      action: pick(token),
      text: tokenValue(token, t),
      ...(token.facet === 'held' && input.held !== null ? { detail: String(input.held) } : {}),
    })),
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
        const text = tokenValue(token, t)
        const mark = markOf(token, text)
        return { key: tokenKey(token), action: pick(token), text, ...(mark ? { mark } : {}) }
      }),
      ...choicesOf(facet, values, t),
    }
  })
  return [conditions, ...groups].filter((group) => group.options.length)
}

/**
 * The groups narrowed to what the typed text names: a value whose word holds
 * it, or every value of a facet whose name does («приор» offers the
 * priorities). A group narrowed to some of its values leaves its choices out,
 * so ↓ and Enter take the value found rather than a choice nobody typed.
 */
function narrowGroups<Group extends FilterGroup>(groups: readonly Group[], text: string): Group[] {
  const needle = text.trim().toLocaleLowerCase()
  return needle
    ? groups
        .map((group) =>
          group.name.toLocaleLowerCase().includes(needle) ? group : narrowValues(group, needle),
        )
        .filter((group) => group.options.length)
    : [...groups]
}

/** A group with only the values whose word holds the needle, and without its choices. */
function narrowValues<Group extends FilterGroup>(group: Group, needle: string): Group {
  const narrowed: Group = {
    ...group,
    options: group.options.filter((option) => option.text.toLocaleLowerCase().includes(needle)),
  }
  delete narrowed.choices
  return narrowed
}

/**
 * The menu at its step. With no text, the facets: the conditions, then one row per
 * facet that steps into its values. Typed text in the facets' step still finds a
 * value of any facet, the fast path for someone who knows the word; in a facet's
 * step it narrows that facet's values. Text always ends the menu with the way to
 * search for it in every project, which the board's filter cannot do.
 */
export function stepGroups(
  groups: readonly ValueGroup[],
  step: FilterStep,
  text: string,
  t: Translate,
): FilterGroup[] {
  const needle = text.trim()
  const everywhere: FilterGroup[] = needle
    ? [
        {
          id: 'everywhere',
          name: t('workItem.filter.everywhere.group'),
          bare: true,
          options: [
            {
              key: 'everywhere',
              text: t('workItem.filter.everywhere.row', { text: needle }),
              action: { do: 'find' },
            },
          ],
        },
      ]
    : []
  const facet = step === 'facets' ? undefined : groups.find((group) => group.id === step)
  if (facet) {
    const values = needle ? narrowValues(facet, needle.toLocaleLowerCase()) : facet
    const back: FilterOption = { key: 'back', text: facet.name, action: { do: 'back' } }
    return [{ ...values, back }, ...everywhere]
  }
  if (needle) return [...narrowGroups(groups, needle), ...everywhere]
  const conditions = groups.filter((group) => group.id === 'conditions')
  const steps: FilterGroup = {
    id: 'facets',
    name: t('workItem.filter.facets'),
    options: groups
      .filter((group) => group.id !== 'conditions')
      .map((group) => ({
        key: `open:${group.id}`,
        text: group.name,
        action: { do: 'open', facet: group.id as ValueFacet },
      })),
  }
  return [...conditions, steps]
}

/** Whether a value row's token is in the filter; a row that is no value is not chosen at all. */
const picked = (filter: WorkFilter, option: FilterOption) =>
  option.action.do === 'pick' ? hasToken(filter, option.action.token) : undefined

/** Whether a value row's value is in the filter negated, «не равно». */
function excluded(filter: WorkFilter, option: FilterOption): boolean {
  const { action } = option
  return action.do === 'pick' && 'value' in action.token
    ? hasToken(filter, { ...action.token, not: true })
    : false
}

/** The glyph in a row's check place: the search's own, or the chip's cross for a value negated. */
function rowIcon(option: FilterOption, negated: boolean): string | undefined {
  if (option.action.do === 'find') return 'search'
  return negated ? 'close' : undefined
}

/**
 * The groups as the list draws them: each value's word, its mark where the registry draws
 * one, and whether it is in. The field hands in none while the menu is closed. A space's
 * labels made it a list of some two thousand nodes that the board built, out of sight,
 * before its first tile could show; it is built when it opens instead, and then only for
 * the step on show.
 */
export function drawnGroups(groups: readonly FilterGroup[], filter: WorkFilter, t: Translate) {
  return groups.map((group) => ({
    id: group.id,
    name: group.name,
    bare: group.bare,
    back: group.back && {
      key: group.back.key,
      name: t('workItem.filter.back', { facet: group.name }),
    },
    options: group.options.map((option) => {
      // A value the work must not carry is in the filter too, marked as the chip's cross is.
      const negated = excluded(filter, option)
      return {
        key: option.key,
        text: option.text,
        name: negated ? t('workItem.filter.excluded', { value: option.text }) : undefined,
        detail: option.detail,
        mark: option.mark,
        icon: rowIcon(option, negated),
        next: option.action.do === 'open',
        selected: negated || picked(filter, option),
      }
    }),
    choices: group.choices?.map((choice) => ({
      key: choice.key,
      name: choice.name,
      text: choice.text,
      title: choice.title,
      selected: (filter.labelsMatch ?? 'all') === choice.match,
    })),
  }))
}
