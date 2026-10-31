/**
 * Which board lanes the operator folded or opened, per planning space.
 *
 * A lane starts folded when nothing in it is open, so a board of forty epics
 * opens on the dozen with work left. Only what the operator chose against that
 * is kept: a lane nobody touched follows its work and opens again when work
 * arrives, and a choice survives a reload.
 *
 * Browser storage rather than the address. The address is bounded and is what a
 * shared link carries, and a set of folded lanes is neither part of what a link
 * points at nor small. Storage can be missing or refuse a write; then the
 * choice lasts as long as the page, which is all it loses.
 */
import { computed } from 'vue'

import { useStorage } from '@vueuse/core'

import type { BoardLane } from '@/widgets/work-item-views/utils/boardLanes.ts'

type Choices = Record<string, Record<string, boolean>>

const STORAGE_KEY = 'valkama-board-lanes'
/** Spaces remembered, newest kept; a lane choice older than that is the default again. */
const MAX_SPACES = 24
/** Lanes remembered per space. */
const MAX_LANES = 400

function readable(value: unknown): Choices {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  const choices: Choices = {}
  for (const [space, lanes] of Object.entries(value)) {
    if (typeof lanes !== 'object' || lanes === null || Array.isArray(lanes)) continue
    const kept = Object.entries(lanes).filter(([, folded]) => typeof folded === 'boolean')
    choices[space] = Object.fromEntries(kept.slice(-MAX_LANES)) as Record<string, boolean>
  }
  return choices
}

export function useLaneCollapse(space: () => string) {
  const stored = useStorage<Choices>(
    STORAGE_KEY,
    {},
    typeof localStorage === 'undefined' ? undefined : localStorage,
    {
      mergeDefaults: (value) => readable(value),
      onError() {
        // Storage that refuses a write keeps the choice for as long as the page.
      },
    },
  )
  const choices = computed(() => readable(stored.value)[space()] ?? {})

  /**
   * Whether a lane is folded. Under a filter a lane nobody folded shows its
   * matches, because a search that found a finished item should show it.
   */
  function folded(lane: BoardLane, filtered: boolean): boolean {
    const chosen = choices.value[lane.id]
    if (chosen !== undefined) return chosen
    return filtered ? lane.items.length === 0 : lane.open === 0
  }

  /**
   * Fold or open a lane. Outside a filter, a choice that matches what the lane's
   * work implies is forgotten, so the lane goes back to following it.
   */
  function toggle(lane: BoardLane, filtered: boolean) {
    const next = !folded(lane, filtered)
    const { [space()]: current = {}, ...others } = readable(stored.value)
    const rest = Object.entries(current).filter(([id]) => id !== lane.id)
    const implied = !filtered && next === (lane.open === 0)
    const lanes = implied ? rest : [...rest, [lane.id, next] as const]
    stored.value = {
      ...Object.fromEntries(Object.entries(others).slice(-(MAX_SPACES - 1))),
      [space()]: Object.fromEntries(lanes.slice(-MAX_LANES)),
    }
  }

  return { folded, toggle }
}
