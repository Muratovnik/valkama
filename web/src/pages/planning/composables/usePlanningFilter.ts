import { computed, readonly, ref, shallowRef, watch } from 'vue'

import {
  EMPTY_WORK_FILTER,
  readWorkFilter,
  toggleToken,
  WORK_FILTER_STATE_KEYS,
  writeWorkFilter,
} from '@/entities/work-item/utils/workFilter.ts'
import type { WorkFilter, WorkFilterToken } from '@/entities/work-item/utils/workFilter.ts'

type RouteState = Record<string, string | number | boolean>

interface FilterRoute {
  /** The manifest's bound on that state, which the route is validated against. */
  maxBytes: () => number
  /** The module state the route holds now. */
  state: () => RouteState | undefined
  /** Replace the module state; the route answers with it later. */
  write: (state: RouteState) => void
}

/** The filter's part of a route state, as one comparable string. */
function addressOf(state: RouteState | undefined): string {
  return JSON.stringify(Object.values(WORK_FILTER_STATE_KEYS).map((key) => state?.[key] ?? null))
}

/**
 * The Work filter, owned by the workspace and kept in the address.
 *
 * The filter the views read is this one, changed at once on every keystroke
 * and click; the route follows it. The two are not interchangeable: the route
 * answers a write a moment later, it may hold less than the filter when the
 * filter does not fit its bound, and a keystroke made before the answer
 * arrives must not be undone by it. So the route's answers to this filter's
 * own writes are recognised and passed over, and any other change of the
 * route's filter — Back, Forward, a link, a space switch that cleared it — is
 * adopted as the filter.
 */
export function usePlanningFilter(route: FilterRoute) {
  const filter = shallowRef<WorkFilter>(readWorkFilter(route.state()))
  /** Whether the address holds the whole filter, so a reload restores all of it. */
  const stored = ref(true)
  /** The route states this filter wrote that the route has not answered with yet. */
  let pending: string[] = []

  function set(next: WorkFilter) {
    filter.value = next
    const { complete, state } = writeWorkFilter(route.state(), next, route.maxBytes())
    stored.value = complete
    const address = addressOf(state)
    // Compared with what the route will hold once it has answered, not with
    // what it holds now: undoing a write still on its way is a write too.
    if (address === (pending.at(-1) ?? addressOf(route.state()))) return
    pending.push(address)
    route.write(state)
  }

  watch(
    () => addressOf(route.state()),
    (address) => {
      const own = pending.indexOf(address)
      if (own >= 0) {
        // An answer to a write of ours; any older write it overtook is moot.
        pending = pending.slice(own + 1)
        return
      }
      pending = []
      filter.value = readWorkFilter(route.state())
      stored.value = true
    },
  )

  return {
    filter: computed(() => filter.value),
    stored: readonly(stored),
    set,
    /** A mark clicked on a view: in it goes, or out if it was in. */
    toggle: (token: WorkFilterToken) => set(toggleToken(filter.value, token)),
    reset: () => set(EMPTY_WORK_FILTER),
  }
}
