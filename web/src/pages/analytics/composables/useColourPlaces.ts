/**
 * The rows each colour key of the Analytics page is ranked over: the period's answer by the key's
 * dimension, or by its pair, without the page's filters and within the scope's project. A value is
 * the colour of its place in that ranking (`rankedSlots`), so a filter that takes values away
 * repaints none of those it leaves; another measure ranks the same rows again and may repaint.
 *
 * It asks nothing while no filter is set: every answer the page reads with none is taken in as it
 * lands (`take`), and its rows are the key. Setting a filter asks nothing either: the answers read
 * before it are the period's without it, and they stay the key under whatever filter follows,
 * until the period or the scope changes. Only a key no answer without the filters gave in this
 * round — the page opened with a filter, a split chosen under one, or a refresh while one is set
 * (`renew`) — is asked again without them, once per key and round. Until that answer lands, a key
 * of the round before stands, and one never held is the answer's own rows (`rows` gives none); a
 * read of it that fails leaves the key as it stood, and the next answer of that key asks again.
 */
import { inject, provide, shallowRef } from 'vue'
import type { InjectionKey } from 'vue'

import { scopeFilters } from '@/pages/analytics/composables/useSharedUsage.ts'
import type { SharedUsage } from '@/pages/analytics/composables/useSharedUsage.ts'

import type { AnalyticsView } from '@/shared/api/analyticsAddress.ts'
import type { Usage, UsageDimension, UsageFilters, UsageRow } from '@/shared/api/analyticsApi.ts'

export interface ColourPlaces {
  /** A refresh: each key held stays until an answer of the new round replaces it. */
  renew: () => void
  /** The rows the colour places of `by`, or its pairs with `across`, rank over; null for none. */
  rows: (by: UsageDimension, across?: UsageDimension | null) => readonly UsageRow[] | null
  /** An answer of the view on show, read by `groupBy` with `filters`, as it lands. */
  take: (groupBy: readonly UsageDimension[], usage: Usage, filters: UsageFilters) => void
}

/** A key's rows, and the round of the answer they came with. */
interface Held {
  round: number
  rows: readonly UsageRow[]
}

const groupOf = (groupBy: readonly UsageDimension[]) => groupBy.join(',')

/** Whether two filters' values are the same values, in any order. */
const sameValues = (left: readonly (string | null)[], right: readonly (string | null)[] = []) =>
  left.length === right.length && left.every((value) => right.includes(value))

/**
 * The page's colour keys for the period and scope `placesKey` names: a new one forgets every key.
 * `read` asks the period without the page's filters, `scope` is the filter of the scope alone.
 */
export function createColourPlaces(options: {
  read: SharedUsage['read']
  placesKey: () => string
  scope: () => UsageFilters
}): ColourPlaces {
  const held = shallowRef<{ byGroup: ReadonlyMap<string, Held>; key: string }>({
    byGroup: new Map(),
    key: '',
  })
  let round = 0
  /** The keys being asked for, each with the round it was asked in. */
  let asking = new Map<string, number>()
  let controller = new AbortController()

  /** Every key of a period and scope no longer on show forgotten, its reads dropped. */
  function forget(key: string) {
    controller.abort()
    controller = new AbortController()
    asking = new Map()
    held.value = { byGroup: new Map(), key }
  }

  function hold(key: string, group: string, entry: Held) {
    if (held.value.key !== key) return
    held.value = { byGroup: new Map(held.value.byGroup).set(group, entry), key }
  }

  /** Whether `filters` are the scope's alone, so an answer read with them is the period's own. */
  function unfiltered(filters: UsageFilters) {
    const scope = options.scope()
    return Object.entries(filters).every(
      ([dimension, values]) =>
        !values?.length || sameValues(values, scope[dimension as UsageDimension]),
    )
  }

  /** Asks the period of `usage` by `groupBy` without the page's filters, for this round. */
  function ask(key: string, groupBy: readonly UsageDimension[], usage: Usage) {
    const group = groupOf(groupBy)
    const asked = round
    asking.set(group, asked)
    const { signal } = controller
    const pending = asking
    const { from, to, utc_offset: utcOffset, step } = usage.period
    options
      .read(
        { from, to, utcOffset, step, groupBy, filters: options.scope(), compare: false },
        signal,
      )
      .then(
        (answer) => {
          if (!signal.aborted) hold(key, group, { round: asked, rows: answer.rows })
        },
        // A key that could not be read stands as it was; the next answer of it asks again.
        () => null,
      )
      .finally(() => {
        if (pending.get(group) === asked) pending.delete(group)
      })
  }

  function take(groupBy: readonly UsageDimension[], usage: Usage, filters: UsageFilters) {
    const key = options.placesKey()
    if (held.value.key !== key) forget(key)
    const group = groupOf(groupBy)
    if (unfiltered(filters)) {
      hold(key, group, { round, rows: usage.rows })
      return
    }
    if (held.value.byGroup.get(group)?.round === round || asking.get(group) === round) return
    ask(key, groupBy, usage)
  }

  function rows(by: UsageDimension, across: UsageDimension | null = null) {
    const { key, byGroup } = held.value
    if (key !== options.placesKey()) return null
    return byGroup.get(groupOf(across ? [by, across] : [by]))?.rows ?? null
  }

  const renew = () => {
    round += 1
  }

  return { renew, rows, take }
}

const PLACES: InjectionKey<ColourPlaces> = Symbol('analytics-colour-places')

/** No key at all, for a part shown outside the page: each chart ranks its own answer's rows. */
const nowhere: ColourPlaces = {
  renew: () => {},
  rows: () => null,
  take: () => {},
}

/** The Analytics page's colour keys, for the page itself and every part inside it. */
export function provideColourPlaces(options: {
  shared: SharedUsage
  projectId: () => string | null
  view: () => AnalyticsView
}): ColourPlaces {
  const places = createColourPlaces({
    placesKey: () => {
      const { period, from, to } = options.view()
      return JSON.stringify({ period, from, to, project: options.projectId() })
    },
    read: (query, signal) => options.shared.read(query, signal),
    scope: () => scopeFilters(options.projectId()),
  })
  provide(PLACES, places)
  return places
}

/** The colour keys of the page a part stands in; none outside one. */
export const useColourPlaces = () => inject(PLACES, nowhere)
