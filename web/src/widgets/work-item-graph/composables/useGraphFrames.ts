/**
 * Which graph frames the operator folded or opened, per planning space.
 *
 * A frame starts folded or open by its structure (`graphFrames`): folded when
 * it holds no open work or a great deal of it. Only what the operator chose
 * against that is kept (`useFoldChoices`), so a frame nobody touched follows
 * its work, and a choice survives a reload.
 *
 * Kept apart from the board's folded lanes: the two start from different
 * defaults, so one choice would mean different things in each.
 */
import { useFoldChoices } from '@/shared/lib/useFoldChoices.ts'

const STORAGE_KEY = 'valkama-graph-frames'

/** A frame as a choice is made against it: what it is now, and what it would be untouched. */
export interface FoldableFrame {
  defaultFolded: boolean
  folded: boolean
  id: string
}

export function useGraphFrames(space: () => string) {
  const { choices, choose } = useFoldChoices(STORAGE_KEY, space)

  /**
   * Fold an open frame or open a folded one. Outside a filter, a choice that
   * matches the frame's default is forgotten, so it follows its work again.
   */
  function toggle(frame: FoldableFrame, filtered: boolean) {
    choose(frame.id, !frame.folded, filtered ? undefined : frame.defaultFolded)
  }

  return { choices, toggle }
}
