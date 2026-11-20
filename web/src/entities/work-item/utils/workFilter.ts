/**
 * What the Work views are narrowed to, as one model: the text a reader typed
 * and the facet values they picked, read the same way by every view and
 * written into the route's `state` so a reload or Back keeps it.
 *
 * It replaces two controls that filtered one population: a five-way queue and
 * a text search, neither of which reached the URL, and neither of which could
 * say "this label" or "this kind" at all.
 */

import { ancestorsOf } from '@/entities/work-item/utils/workTree.ts'

import { PRIORITIES, STATE_CATEGORIES, WORK_ITEM_KINDS } from '@/shared/api/planningModel.ts'
import type { WorkItemBrief } from '@/shared/api/planningModel.ts'
import { actorName } from '@/shared/lib/actor.ts'

type StateCategory = (typeof STATE_CATEGORIES)[number]
type WorkItemKind = (typeof WORK_ITEM_KINDS)[number]
type WorkItemPriority = (typeof PRIORITIES)[number]
/** The one value of «From another space»: a card another space holds. */
type Elsewhere = 'other'

/** The project value of work that names no project, which no project's id can be. */
export const NO_PROJECT = '-'

/** The values a facet is narrowed to, facet by facet. */
interface FacetValues {
  /** State categories. */
  category?: StateCategory[]
  /** A card another space holds: the condition's one value, which «≠» turns into «none of them». */
  elsewhere?: Elsewhere[]
  /** Goals or stages by reference: work in the subtree of any of them, the container included. */
  goal?: string[]
  /** Holders, named as `actorName` names them. */
  holder?: string[]
  /** Kinds. */
  kind?: WorkItemKind[]
  /** Labels. */
  labels?: string[]
  /** Priorities. */
  priority?: WorkItemPriority[]
  /** Projects by id, `NO_PROJECT` for work that names none. */
  project?: string[]
}

/**
 * The facets' own fields are what an item must be: any of these state
 * categories, kinds, priorities or holders, and every one of these labels, each
 * narrowing further, or any one under `labelsMatch`.
 */
export interface WorkFilter extends FacetValues {
  /** A substring of the reference or the title; blank for none. */
  text: string
  /** A task whose question waits for the owner's answer, which keeps the queue from giving it. */
  asked?: true
  /** Held by somebody and not yet finished. */
  held?: true
  /** One of the labels will do. Absent, every one of them has to be on the item. */
  labelsMatch?: 'any'
  /**
   * What an item must not be, «не равно»: none of these values, in any facet.
   * A value is in one of the two lists at most. Absent rather than empty.
   */
  not?: FacetValues
  /** Startable right now, as the server answers it. */
  ready?: true
  /**
   * A card of the space's own triage stack that no review has marked (`awaitsTriage`): what the
   * line «time to triage» of «Needs my answer» counts for the space.
   */
  triage?: true
}

/**
 * One thing a reader can add to the filter or take out of it. A facet's value
 * may be negated: the item must not carry it.
 */
export type WorkFilterToken =
  | { facet: 'ready' }
  | { facet: 'held' }
  | { facet: 'asked' }
  | { facet: 'triage' }
  | { facet: 'elsewhere'; value: Elsewhere; not?: true }
  | { facet: 'category'; value: StateCategory; not?: true }
  | { facet: 'kind'; value: WorkItemKind; not?: true }
  | { facet: 'priority'; value: WorkItemPriority; not?: true }
  | { facet: 'labels'; value: string; not?: true }
  | { facet: 'holder'; value: string; not?: true }
  | { facet: 'project'; value: string; not?: true }
  | { facet: 'goal'; value: string; not?: true }

/** A token of a facet's value, the kind that can be negated. */
export type ValueToken = Extract<WorkFilterToken, { value: string }>

/** How the labels picked combine, as a reader chooses it. */
export type LabelsMatch = 'all' | 'any'

type ListFacet = Extract<WorkFilterToken, { value: string }>['facet']
type FlagFacet = Exclude<WorkFilterToken['facet'], ListFacet>

/** «From another space» first, as the conditions it stands among come first. */
const LIST_FACETS: readonly ListFacet[] = [
  'elsewhere',
  'category',
  'kind',
  'priority',
  'labels',
  'holder',
  'project',
  'goal',
]
/** The conditions with no value, in the order the menu, the chips and the address take them. */
const FLAG_FACETS: readonly FlagFacet[] = ['ready', 'held', 'asked', 'triage']

/** A condition that is on or off, with no value: startable, held, asked, awaiting triage. */
export const isFlag = (
  token: WorkFilterToken,
): token is Extract<WorkFilterToken, { facet: FlagFacet }> =>
  (FLAG_FACETS as readonly string[]).includes(token.facet)

/**
 * Whether a card waits in its space's triage stack with no review's mark: the read gives a stack
 * card its `triage_stack`, with `seen_at` null until a review marks it. A card another space
 * holds stands in that space's stack, not in this one's, so it is not taken here, as the
 * server's line counts a space's own stack alone.
 */
const awaitsTriage = (item: WorkItemBrief) =>
  item.triage_stack !== undefined && item.triage_stack.seen_at === null && !item.other_space

/**
 * The references of an item and of every goal or stage over it, which «Goal or stage»
 * matches against; the item's own alone where nothing reads the tree.
 */
export type Lineage = (item: WorkItemBrief) => readonly string[]
const ownReference: Lineage = (item) => [item.reference]

/** The lineage of every item of a space, read over the whole of it. */
export function lineageIn(space: readonly WorkItemBrief[]): Lineage {
  const byId = new Map(space.map((item) => [item.work_item_id, item]))
  return (item) => [item.reference, ...ancestorsOf(item, byId).map((parent) => parent.reference)]
}

export const EMPTY_WORK_FILTER: WorkFilter = Object.freeze({ text: '' })

/** Whether the filter lets everything through. */
export function isWorkFilterEmpty(filter: WorkFilter): boolean {
  return filterTokens(filter).length === 0 && filter.text.trim() === ''
}

/** Whether an item carries the labels picked, as the filter says they combine. */
function labelsHold(item: WorkItemBrief, filter: WorkFilter): boolean {
  const labels = filter.labels ?? []
  if (!labels.length) return true
  return filter.labelsMatch === 'any'
    ? labels.some((label) => item.labels.includes(label))
    : labels.every((label) => item.labels.includes(label))
}

/** Whether an item names any of these projects, or none where `NO_PROJECT` is one of them. */
const inProject = (item: WorkItemBrief, projects: readonly string[] | undefined) =>
  Boolean(
    projects?.some((project) =>
      project === NO_PROJECT
        ? item.projects.length === 0
        : item.projects.some((named) => named.project_id === project),
    ),
  )

/** Whether an item stands in the subtree of any of these goals or stages. */
const underGoal = (item: WorkItemBrief, goals: readonly string[] | undefined, lineage: Lineage) =>
  Boolean(goals?.length) && lineage(item).some((reference) => goals?.includes(reference))

/** An accepted open goal or stage stands in no category, so no category takes it in. */
const inCategory = (item: WorkItemBrief, categories: readonly string[] | undefined) =>
  item.state !== null && Boolean(categories?.includes(item.state.category))

/**
 * Whether an item is any of the values the filter says it must not be. Work
 * nobody holds is not held by the holder named, so it passes «holder is not».
 */
function excluded(item: WorkItemBrief, not: FacetValues | undefined, lineage: Lineage): boolean {
  return (
    (Boolean(not?.elsewhere?.length) && Boolean(item.other_space)) ||
    inProject(item, not?.project) ||
    underGoal(item, not?.goal, lineage) ||
    inCategory(item, not?.category) ||
    Boolean(not?.kind?.includes(item.kind)) ||
    Boolean(not?.priority?.includes(item.priority)) ||
    Boolean(not?.labels?.some((label) => item.labels.includes(label))) ||
    (item.claim_ref !== '' && Boolean(not?.holder?.includes(actorName(item.claim_ref))))
  )
}

/**
 * Whether an item passes: every facet present must hold (AND across facets),
 * any one value of a facet will do (OR within it), except labels, where each
 * label picked must be on the item (AND), because a click on a second label
 * is read as "and this one too", until the reader says any one will do. A
 * value negated keeps out every item that carries it, whatever else holds.
 */
export function matchesWorkFilter(
  item: WorkItemBrief,
  filter: WorkFilter,
  lineage: Lineage = ownReference,
): boolean {
  if (!textHolds(item, filter.text)) return false
  if (!conditionsHold(item, filter)) return false
  if (filter.project?.length && !inProject(item, filter.project)) return false
  if (filter.goal?.length && !underGoal(item, filter.goal, lineage)) return false
  if (filter.category?.length && !inCategory(item, filter.category)) return false
  if (filter.kind?.length && !filter.kind.includes(item.kind)) return false
  if (filter.priority?.length && !filter.priority.includes(item.priority)) return false
  if (!labelsHold(item, filter)) return false
  if (
    filter.holder?.length &&
    (item.claim_ref === '' || !filter.holder.includes(actorName(item.claim_ref)))
  )
    return false
  return !excluded(item, filter.not, lineage)
}

/** Whether the reference or the title holds the text typed, any case; blank holds for all. */
function textHolds(item: WorkItemBrief, typed: string): boolean {
  const text = typed.trim().toLocaleLowerCase()
  return (
    !text ||
    item.reference.toLocaleLowerCase().includes(text) ||
    item.title.toLocaleLowerCase().includes(text)
  )
}

/**
 * The conditions: startable now, as the server answers it; held and not finished; a
 * question waiting for the owner's answer, the reason the queue gives the server; a card
 * of the space's triage stack no review has marked; and a card of another space.
 */
function conditionsHold(item: WorkItemBrief, filter: WorkFilter): boolean {
  if (filter.ready && !item.workable) return false
  if (filter.held && (item.claim_ref === '' || !item.open)) return false
  if (filter.asked && !item.withheld.includes('question')) return false
  if (filter.triage && !awaitsTriage(item)) return false
  return !filter.elsewhere?.length || Boolean(item.other_space)
}

/** The filter's facet tokens in a stable order: flags, then each list facet, its values before those negated. */
export function filterTokens(filter: WorkFilter): WorkFilterToken[] {
  const tokens: WorkFilterToken[] = FLAG_FACETS.filter((facet) => filter[facet]).map((facet) => ({
    facet,
  }))
  for (const facet of LIST_FACETS) {
    for (const value of filter[facet] ?? []) tokens.push({ facet, value } as WorkFilterToken)
    for (const value of filter.not?.[facet] ?? [])
      tokens.push({ facet, value, not: true } as WorkFilterToken)
  }
  return tokens
}

/** The values of the token's facet in the token's own list: the facet's, or its negated ones. */
const listOf = (filter: WorkFilter, token: ValueToken): readonly string[] =>
  (token.not ? filter.not?.[token.facet] : filter[token.facet]) ?? []

export function hasToken(filter: WorkFilter, token: WorkFilterToken): boolean {
  return isFlag(token) ? filter[token.facet] === true : listOf(filter, token).includes(token.value)
}

/** Whether the token's value is in the filter either way, as it is or negated. */
const hasValue = (filter: WorkFilter, token: ValueToken) =>
  [...listOf(filter, { ...token, not: true }), ...(filter[token.facet] ?? [])].includes(token.value)

/** The lists with the facet's set to `values`; an emptied list is dropped, not left as []. */
function setList<Lists extends FacetValues>(lists: Lists, facet: ListFacet, values: string[]) {
  const next: Lists = { ...lists }
  if (values.length) Object.assign(next, { [facet]: values })
  else delete next[facet]
  return next
}

/** A new filter whose list of the token's kind is `values`; an emptied `not` is dropped too. */
function withList(filter: WorkFilter, token: ValueToken, values: string[]): WorkFilter {
  if (!token.not) return setList(filter, token.facet, values)
  const next: WorkFilter = { ...filter, not: setList(filter.not ?? {}, token.facet, values) }
  if (!Object.keys(next.not ?? {}).length) delete next.not
  return next
}

/**
 * A new filter with the token in it; the filter itself is never changed. A value
 * in the other list moves, since an item cannot both be and not be it.
 */
export function addToken(filter: WorkFilter, token: WorkFilterToken): WorkFilter {
  if (hasToken(filter, token)) return filter
  if (isFlag(token)) return { ...filter, [token.facet]: true }
  const other = { ...token, not: token.not ? undefined : true } as ValueToken
  const rest = removeToken(filter, other)
  return withList(rest, token, [...listOf(rest, token), token.value])
}

/** A new filter without the token; an emptied facet is dropped, not left as []. */
export function removeToken(filter: WorkFilter, token: WorkFilterToken): WorkFilter {
  if (isFlag(token)) {
    const next: WorkFilter = { ...filter }
    delete next[token.facet]
    return next
  }
  return listOf(filter, token).includes(token.value)
    ? withList(
        filter,
        token,
        listOf(filter, token).filter((value) => value !== token.value),
      )
    : filter
}

/**
 * What a click on a filterable mark or a menu value does: add it, or take it
 * out again, whichever way it was in, negated included.
 */
export function toggleToken(filter: WorkFilter, token: WorkFilterToken): WorkFilter {
  if (isFlag(token))
    return hasToken(filter, token) ? removeToken(filter, token) : addToken(filter, token)
  if (!hasValue(filter, token)) return addToken(filter, token)
  return removeToken(removeToken(filter, { ...token, not: undefined } as ValueToken), {
    ...token,
    not: true,
  })
}

/** «Не равно» switched on a chip: the value moves to the other list, at its end. */
export function negateToken(filter: WorkFilter, token: ValueToken): WorkFilter {
  return addToken(filter, { ...token, not: token.not ? undefined : true } as ValueToken)
}

/** A new filter that reads its labels this way; all is the absence of the field. */
export function setLabelsMatch(filter: WorkFilter, match: LabelsMatch): WorkFilter {
  const next: WorkFilter = { ...filter }
  if (match === 'any') next.labelsMatch = 'any'
  else delete next.labelsMatch
  return next
}

/**
 * The conditions no facet's values say: startable right now, held by somebody and
 * not yet finished, a question waiting for the owner's answer, a card of the space's
 * triage stack no review has marked, and a card another space holds. The filter's
 * menu offers them first, as values of their own, and a chip says each; nothing beside
 * the field stands for them. The last is a value, so its chip turns it over: «≠» keeps
 * every card of another space out.
 */
export const WORK_FILTER_CONDITIONS: readonly WorkFilterToken[] = [
  ...FLAG_FACETS.map((facet) => ({ facet })),
  { facet: 'elsewhere', value: 'other' },
]

// ---------------------------------------------------------------------------
// The route's `state` object.
// ---------------------------------------------------------------------------

/**
 * The keys a filter writes into the route's module state. Absent means no
 * filter on that facet. The text uses `query`, the key the planning manifest
 * already declares; the module manifest has to allow the rest before a route
 * carrying them is accepted.
 */
export const WORK_FILTER_STATE_KEYS = {
  text: 'query',
  ready: 'ready',
  held: 'held',
  asked: 'asked',
  triage: 'triage',
  elsewhere: 'elsewhere',
  category: 'cat',
  kind: 'kind',
  priority: 'pri',
  labels: 'labels',
  holder: 'holder',
  project: 'proj',
  goal: 'goal',
} as const

/** The longest string a route state value may hold (`platformRoute.ts`). */
export const ROUTE_STATE_VALUE_CHARS = 240

type RouteState = Record<string, string | number | boolean>

/**
 * Lists are comma-joined. A label typed in the composer cannot hold a comma,
 * because the composer splits on it, but the server takes any text and an
 * agent can write one; so a comma and the escape character itself are
 * percent-escaped rather than trusted to be absent.
 */
const escapeValue = (value: string) => value.replaceAll('%', '%25').replaceAll(',', '%2C')
const unescapeValue = (value: string) => value.replaceAll('%2C', ',').replaceAll('%25', '%')

/**
 * What `labels` starts with when any one of them will do; all writes nothing, so a link made
 * before the labels could combine reads as it did. It rides that key rather than one of its
 * own because the manifest the route is validated against names the keys. No label can be
 * written this way, since each `%` of a label is written `%25`.
 */
const LABELS_ANY = '%any'

/**
 * What a negated value starts with, inside its facet's own key: `labels=ui,%-agent`
 * is «ui, and not agent». A link made before values could be negated never holds it,
 * because each `%` of a value is written `%25`, so every old link reads as it did,
 * and the manifest needs no key of its own for it.
 */
const NOT_MARK = '%-'

const VALID_VALUES: Record<ListFacet, ((value: string) => boolean) | null> = {
  category: (value) => (STATE_CATEGORIES as readonly string[]).includes(value),
  kind: (value) => (WORK_ITEM_KINDS as readonly string[]).includes(value),
  priority: (value) => (PRIORITIES as readonly string[]).includes(value),
  labels: null,
  holder: null,
  elsewhere: (value) => value === 'other',
  project: null,
  goal: null,
}

/**
 * The filter a route state holds. A key that is malformed — a hand-edited URL,
 * a value from a later version — is read as no filter on that facet rather
 * than as a broken route, and unknown values inside a list are dropped.
 */
export function readWorkFilter(state: RouteState | undefined): WorkFilter {
  const filter: WorkFilter = { text: '' }
  if (!state) return filter
  const text = state[WORK_FILTER_STATE_KEYS.text]
  if (typeof text === 'string') filter.text = text
  for (const flag of FLAG_FACETS)
    if (state[WORK_FILTER_STATE_KEYS[flag]] === true) filter[flag] = true
  for (const facet of LIST_FACETS) {
    let raw = state[WORK_FILTER_STATE_KEYS[facet]]
    if (typeof raw !== 'string') continue
    if (facet === 'labels' && (raw === LABELS_ANY || raw.startsWith(`${LABELS_ANY},`))) {
      filter.labelsMatch = 'any'
      raw = raw.slice(LABELS_ANY.length + 1)
    }
    if (raw === '') continue
    readFacet(filter, facet, raw)
  }
  return filter
}

/** A value of a filter key without the mark that negates it. */
const withoutNotMark = (part: string) =>
  part.startsWith(NOT_MARK) ? part.slice(NOT_MARK.length) : part

/**
 * Whether every value the state's filter keys hold is one this build reads: a category, a
 * kind or a priority it knows, wherever it stands in its list or under a negation. A value
 * it does not know is what `readWorkFilter` drops, so a state for which this says no reads
 * as a narrower filter than the one it was written with.
 */
export function readsEveryFilterValue(state: RouteState | undefined): boolean {
  return LIST_FACETS.every((facet) => {
    const valid = VALID_VALUES[facet]
    const raw = state?.[WORK_FILTER_STATE_KEYS[facet]]
    if (valid === null || typeof raw !== 'string') return true
    const values = raw.split(',').map((part) => unescapeValue(withoutNotMark(part)))
    return values.every((value) => value === '' || valid(value))
  })
}

/**
 * One facet's key into the filter: its values, and those after the not mark. A
 * value in both reads as itself.
 */
function readFacet(filter: WorkFilter, facet: ListFacet, raw: string) {
  const valid = VALID_VALUES[facet]
  const kept = (value: string) => value !== '' && (valid === null || valid(value))
  const read = (parts: readonly string[]) =>
    [...new Set(parts.map((part) => unescapeValue(part)))].filter((value) => kept(value))
  const parts = raw.split(',')
  const values = read(parts.filter((part) => !part.startsWith(NOT_MARK)))
  const not = read(
    parts.filter((part) => part.startsWith(NOT_MARK)).map((part) => part.slice(NOT_MARK.length)),
  ).filter((value) => !values.includes(value))
  if (values.length) Object.assign(filter, { [facet]: values })
  if (not.length) filter.not = { ...filter.not, [facet]: not }
}

/** The UTF-8 size of a state, measured as the manifest bound measures it. */
const stateBytes = (state: RouteState) => new TextEncoder().encode(JSON.stringify(state)).byteLength

/** Cut a string to a number of UTF-16 units without leaving half a pair behind. */
function cutText(text: string, units: number): string {
  let cut = text.slice(0, Math.max(0, units))
  if (/[\uD800-\uDBFF]$/u.test(cut)) cut = cut.slice(0, -1)
  return cut
}

/** Whole values, joined, that fit in one state value. A value is never cut. */
function joinWithin(parts: readonly string[], chars: number): { kept: number; value: string } {
  let value = ''
  let kept = 0
  for (const part of parts) {
    const next = value ? `${value},${part}` : part
    if (next.length > chars) break
    value = next
    kept += 1
  }
  return { kept, value }
}

/** A facet's values as the state writes them: as they are, then those negated. */
const facetParts = (filter: WorkFilter, facet: ListFacet) => [
  ...(filter[facet] ?? []).map((value) => escapeValue(value)),
  ...(filter.not?.[facet] ?? []).map((value) => `${NOT_MARK}${escapeValue(value)}`),
]

/** The facet's last value as the state writes it, the first to go when the state is too long. */
function lastToken(filter: WorkFilter, facet: ListFacet): ValueToken | undefined {
  const negated = filter.not?.[facet]?.at(-1)
  if (negated !== undefined) return { facet, value: negated, not: true } as ValueToken
  const value = filter[facet]?.at(-1)
  return value === undefined ? undefined : ({ facet, value } as ValueToken)
}

function encodeFilter(filter: WorkFilter): { complete: boolean; entries: RouteState } {
  const entries: RouteState = {}
  let complete = true
  const text = cutText(filter.text, ROUTE_STATE_VALUE_CHARS)
  if (text !== filter.text) complete = false
  if (text.trim()) entries[WORK_FILTER_STATE_KEYS.text] = text
  for (const flag of FLAG_FACETS) if (filter[flag]) entries[WORK_FILTER_STATE_KEYS[flag]] = true
  for (const facet of LIST_FACETS) {
    const values = facetParts(filter, facet)
    const mark = facet === 'labels' && filter.labelsMatch === 'any' ? `${LABELS_ANY},` : ''
    const { kept, value } = joinWithin(values, ROUTE_STATE_VALUE_CHARS - mark.length)
    if (kept < values.length) complete = false
    if (kept) entries[WORK_FILTER_STATE_KEYS[facet]] = `${mark}${value}`
    else if (mark) entries[WORK_FILTER_STATE_KEYS[facet]] = LABELS_ANY
  }
  return { complete, entries }
}

/**
 * The route state that holds a filter and nothing else, for a link that opens a view with it.
 * It is for a filter of conditions, which fits any bound a manifest sets; one that may not
 * fit goes through `writeWorkFilter` instead.
 */
export const filterRouteState = (filter: WorkFilter): RouteState => encodeFilter(filter).entries

/**
 * Write a filter into a route state: the filter's keys are replaced, every
 * other key is kept, and the whole state stays within `maxBytes` — pass the
 * module manifest's `state_schema.max_bytes`, which the route is validated
 * against. Each value stays within the route's 240-character bound.
 *
 * What does not fit is left out whole, from the end: the last value of the
 * longest list first, then the text from its end. `complete` says whether the
 * written filter is the whole filter, so a caller can say so instead of
 * silently showing a different one after a reload.
 */
export function writeWorkFilter(
  state: RouteState | undefined,
  filter: WorkFilter,
  maxBytes: number,
): { complete: boolean; state: RouteState } {
  const base: RouteState = { ...state }
  for (const key of Object.values(WORK_FILTER_STATE_KEYS)) delete base[key]
  let current: WorkFilter = { ...filter }
  let { complete, entries } = encodeFilter(current)
  while (stateBytes({ ...base, ...entries }) > maxBytes) {
    complete = false
    const longest = LIST_FACETS.filter((facet) => lastToken(current, facet)).sort(
      (left, right) =>
        String(entries[WORK_FILTER_STATE_KEYS[right]] ?? '').length -
        String(entries[WORK_FILTER_STATE_KEYS[left]] ?? '').length,
    )[0]
    const last = longest && lastToken(current, longest)
    if (last) {
      current = removeToken(current, last)
    } else if (current.text) {
      const over = stateBytes({ ...base, ...entries }) - maxBytes
      current = { ...current, text: cutText(current.text, current.text.length - Math.max(1, over)) }
    } else {
      // Only flags are left, or other keys alone are over the bound.
      entries = {}
      break
    }
    entries = encodeFilter(current).entries
  }
  return { complete, state: { ...base, ...entries } }
}
