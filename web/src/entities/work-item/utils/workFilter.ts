/**
 * What the Work views are narrowed to, as one model: the text a reader typed
 * and the facet values they picked, read the same way by every view and
 * written into the route's `state` so a reload or Back keeps it.
 *
 * It replaces two controls that filtered one population: a five-way queue and
 * a text search, neither of which reached the URL, and neither of which could
 * say "this label" or "this kind" at all.
 */

import { PRIORITIES, STATE_CATEGORIES, WORK_ITEM_KINDS } from '@/shared/api/planningModel.ts'
import type { WorkItemBrief } from '@/shared/api/planningModel.ts'
import { actorName } from '@/shared/lib/actor.ts'

type StateCategory = (typeof STATE_CATEGORIES)[number]
type WorkItemKind = (typeof WORK_ITEM_KINDS)[number]
type WorkItemPriority = (typeof PRIORITIES)[number]

export interface WorkFilter {
  /** A substring of the reference or the title; blank for none. */
  text: string
  /** Any of these state categories. */
  category?: StateCategory[]
  /** Held by somebody and not yet finished. */
  held?: true
  /** Held by any of these holders, named as `actorName` names them. */
  holder?: string[]
  /** Any of these kinds. */
  kind?: WorkItemKind[]
  /** Every one of these labels: each label picked narrows further. */
  labels?: string[]
  /** Any of these priorities. */
  priority?: WorkItemPriority[]
  /** Startable right now, as the server answers it. */
  ready?: true
}

/** One thing a reader can add to the filter or take out of it. */
export type WorkFilterToken =
  | { facet: 'ready' }
  | { facet: 'held' }
  | { facet: 'category'; value: StateCategory }
  | { facet: 'kind'; value: WorkItemKind }
  | { facet: 'priority'; value: WorkItemPriority }
  | { facet: 'labels'; value: string }
  | { facet: 'holder'; value: string }

type ListFacet = 'category' | 'kind' | 'priority' | 'labels' | 'holder'
type FlagFacet = 'ready' | 'held'

const LIST_FACETS: readonly ListFacet[] = ['category', 'kind', 'priority', 'labels', 'holder']

export const EMPTY_WORK_FILTER: WorkFilter = Object.freeze({ text: '' })

/** Whether the filter lets everything through. */
export function isWorkFilterEmpty(filter: WorkFilter): boolean {
  return filterTokens(filter).length === 0 && filter.text.trim() === ''
}

/**
 * Whether an item passes: every facet present must hold (AND across facets),
 * any one value of a facet will do (OR within it), except labels, where each
 * label picked must be on the item (AND), because a click on a second label
 * is read as "and this one too".
 */
export function matchesWorkFilter(item: WorkItemBrief, filter: WorkFilter): boolean {
  const text = filter.text.trim().toLocaleLowerCase()
  if (
    text &&
    !item.reference.toLocaleLowerCase().includes(text) &&
    !item.title.toLocaleLowerCase().includes(text)
  )
    return false
  if (filter.ready && !item.ready) return false
  if (filter.held && (item.claim_ref === '' || item.state.is_terminal)) return false
  if (filter.category?.length && !filter.category.includes(item.state.category)) return false
  if (filter.kind?.length && !filter.kind.includes(item.kind)) return false
  if (filter.priority?.length && !filter.priority.includes(item.priority)) return false
  if (filter.labels?.some((label) => !item.labels.includes(label))) return false
  if (
    filter.holder?.length &&
    (item.claim_ref === '' || !filter.holder.includes(actorName(item.claim_ref)))
  )
    return false
  return true
}

/** The filter's facet tokens in a stable order: flags, then each list facet. */
export function filterTokens(filter: WorkFilter): WorkFilterToken[] {
  const tokens: WorkFilterToken[] = []
  if (filter.ready) tokens.push({ facet: 'ready' })
  if (filter.held) tokens.push({ facet: 'held' })
  for (const facet of LIST_FACETS)
    for (const value of filter[facet] ?? []) tokens.push({ facet, value } as WorkFilterToken)
  return tokens
}

export function hasToken(filter: WorkFilter, token: WorkFilterToken): boolean {
  return token.facet === 'ready' || token.facet === 'held'
    ? filter[token.facet] === true
    : ((filter[token.facet] as readonly string[] | undefined)?.includes(token.value) ?? false)
}

/** A new filter with the token in it; the filter itself is never changed. */
export function addToken(filter: WorkFilter, token: WorkFilterToken): WorkFilter {
  if (hasToken(filter, token)) return filter
  if (token.facet === 'ready' || token.facet === 'held') return { ...filter, [token.facet]: true }
  const values = (filter[token.facet] as readonly string[] | undefined) ?? []
  return { ...filter, [token.facet]: [...values, token.value] }
}

/** A new filter without the token; an emptied facet is dropped, not left as []. */
export function removeToken(filter: WorkFilter, token: WorkFilterToken): WorkFilter {
  const next: WorkFilter = { ...filter }
  if (token.facet === 'ready' || token.facet === 'held') {
    delete next[token.facet as FlagFacet]
    return next
  }
  const values = ((filter[token.facet] as readonly string[] | undefined) ?? []).filter(
    (value) => value !== token.value,
  )
  if (values.length) Object.assign(next, { [token.facet]: values })
  else delete next[token.facet]
  return next
}

/** What a click on a filterable mark does: add it, or take it out again. */
export function toggleToken(filter: WorkFilter, token: WorkFilterToken): WorkFilter {
  return hasToken(filter, token) ? removeToken(filter, token) : addToken(filter, token)
}

/**
 * A named shortcut beside the filter field. A preset is only a list of tokens,
 * so which presets the bar offers is data: the two below are the queues no
 * view shows by itself. Offering blocked and review as presets too, or none at
 * all, is a change to this list and not to the model.
 */
export interface WorkFilterPreset {
  id: string
  /** The i18n key of its label. */
  label: string
  tokens: readonly WorkFilterToken[]
}

export const WORK_FILTER_PRESETS: readonly WorkFilterPreset[] = [
  { id: 'ready', label: 'workItem.facet.ready', tokens: [{ facet: 'ready' }] },
  { id: 'held', label: 'workItem.facet.held', tokens: [{ facet: 'held' }] },
]

/** A preset is on while every token it stands for is in the filter. */
export function presetActive(filter: WorkFilter, preset: WorkFilterPreset): boolean {
  return preset.tokens.every((token) => hasToken(filter, token))
}

export function togglePreset(filter: WorkFilter, preset: WorkFilterPreset): WorkFilter {
  const step = presetActive(filter, preset) ? removeToken : addToken
  let next = filter
  for (const token of preset.tokens) next = step(next, token)
  return next
}

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
  category: 'cat',
  kind: 'kind',
  priority: 'pri',
  labels: 'labels',
  holder: 'holder',
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

const VALID_VALUES: Record<ListFacet, ((value: string) => boolean) | null> = {
  category: (value) => (STATE_CATEGORIES as readonly string[]).includes(value),
  kind: (value) => (WORK_ITEM_KINDS as readonly string[]).includes(value),
  priority: (value) => (PRIORITIES as readonly string[]).includes(value),
  labels: null,
  holder: null,
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
  if (state[WORK_FILTER_STATE_KEYS.ready] === true) filter.ready = true
  if (state[WORK_FILTER_STATE_KEYS.held] === true) filter.held = true
  for (const facet of LIST_FACETS) {
    const raw = state[WORK_FILTER_STATE_KEYS[facet]]
    if (typeof raw !== 'string' || raw === '') continue
    const valid = VALID_VALUES[facet]
    const values = [...new Set(raw.split(',').map((value) => unescapeValue(value)))].filter(
      (value) => value !== '' && (valid === null || valid(value)),
    )
    if (values.length) Object.assign(filter, { [facet]: values })
  }
  return filter
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
function joinWithin(values: readonly string[], chars: number): { kept: number; value: string } {
  let value = ''
  let kept = 0
  for (const raw of values) {
    const next = value ? `${value},${escapeValue(raw)}` : escapeValue(raw)
    if (next.length > chars) break
    value = next
    kept += 1
  }
  return { kept, value }
}

function encodeFilter(filter: WorkFilter): { complete: boolean; entries: RouteState } {
  const entries: RouteState = {}
  let complete = true
  const text = cutText(filter.text, ROUTE_STATE_VALUE_CHARS)
  if (text !== filter.text) complete = false
  if (text.trim()) entries[WORK_FILTER_STATE_KEYS.text] = text
  if (filter.ready) entries[WORK_FILTER_STATE_KEYS.ready] = true
  if (filter.held) entries[WORK_FILTER_STATE_KEYS.held] = true
  for (const facet of LIST_FACETS) {
    const values = filter[facet] ?? []
    if (!values.length) continue
    const { kept, value } = joinWithin(values, ROUTE_STATE_VALUE_CHARS)
    if (kept < values.length) complete = false
    if (kept) entries[WORK_FILTER_STATE_KEYS[facet]] = value
  }
  return { complete, entries }
}

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
    const longest = LIST_FACETS.filter((facet) => current[facet]?.length).sort(
      (left, right) =>
        String(entries[WORK_FILTER_STATE_KEYS[right]] ?? '').length -
        String(entries[WORK_FILTER_STATE_KEYS[left]] ?? '').length,
    )[0]
    if (longest) {
      const values = current[longest] ?? []
      current = removeToken(current, {
        facet: longest,
        value: values.at(-1),
      } as WorkFilterToken)
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
