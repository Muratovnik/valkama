/**
 * Which graph frames the operator folded or opened, per planning space.
 *
 * A frame starts folded or open by its structure (`graphFrames`): folded when
 * it holds no open work or a great deal of it. Only what the operator chose
 * against that is kept, so a frame nobody touched follows its work, and a
 * choice survives a reload.
 *
 * Kept apart from the board's folded lanes: the two start from different
 * defaults, so one choice would mean different things in each.
 *
 * Browser storage rather than the address, for the board's reasons: a set of
 * folded frames is neither part of what a link points at nor small. Storage can
 * be missing or refuse a write; then the choice lasts as long as the page.
 */
import { computed } from 'vue'

import { useStorage } from '@vueuse/core'

type Choices = Record<string, Record<string, boolean>>

const STORAGE_KEY = 'valkama-graph-frames'
/** Spaces remembered, newest kept. */
const MAX_SPACES = 24
/** Frames remembered per space. */
const MAX_FRAMES = 400

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** What storage holds, read as choices: anything else in it is dropped. */
function choicesIn(value: unknown): Choices {
  if (!isRecord(value)) return {}
  const read: Choices = {}
  for (const [space, frames] of Object.entries(value)) {
    if (!isRecord(frames)) continue
    const kept: [string, boolean][] = []
    for (const [id, folded] of Object.entries(frames))
      if (typeof folded === 'boolean') kept.push([id, folded])
    read[space] = Object.fromEntries(kept.slice(-MAX_FRAMES))
  }
  return read
}

/** A frame as a choice is made against it: what it is now, and what it would be untouched. */
export interface FoldableFrame {
  defaultFolded: boolean
  folded: boolean
  id: string
}

export function useGraphFrames(space: () => string) {
  const stored = useStorage<Choices>(
    STORAGE_KEY,
    {},
    typeof localStorage === 'undefined' ? undefined : localStorage,
    {
      mergeDefaults: (value) => choicesIn(value),
      onError() {
        // Storage that refuses a write keeps the choice for as long as the page.
      },
    },
  )

  /** The operator's choices in this space: true is folded. */
  const choices = computed(() => choicesIn(stored.value)[space()] ?? {})

  /**
   * Fold an open frame or open a folded one. Outside a filter, a choice that
   * matches the frame's default is forgotten, so it follows its work again.
   */
  function toggle(frame: FoldableFrame, filtered: boolean) {
    const folded = !frame.folded
    const { [space()]: current = {}, ...others } = choicesIn(stored.value)
    const rest = Object.entries(current).filter(([id]) => id !== frame.id)
    const kept = !filtered && folded === frame.defaultFolded ? rest : [...rest, [frame.id, folded]]
    stored.value = {
      ...Object.fromEntries(Object.entries(others).slice(-(MAX_SPACES - 1))),
      [space()]: Object.fromEntries(kept.slice(-MAX_FRAMES)),
    }
  }

  return { choices, toggle }
}
