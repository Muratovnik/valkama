/**
 * Where the pointer stands among a step line's places (`StepLine`). One layer over the line's
 * field takes the pointer for every reading and place, half a mark past each edge of the field,
 * and finds the place under it by its x alone (`aimAt`): how far the layer runs past the field is
 * how near a mark the pointer finds that mark. The place found is the stop whose hint shows
 * (`vHintPick`) and whose mark the line paints.
 */
import type { ComputedRef, Ref } from 'vue'

import { aimAt } from '@/shared/ui/windowGeometry.ts'
import type { StepAim, StepFrame } from '@/shared/ui/windowGeometry.ts'

export function useStepAim(
  /** The line's field, and the one layer that takes the pointer over it. */
  { field, hover }: { field: Ref<HTMLElement | null>; hover: Ref<HTMLElement | null> },
  frame: ComputedRef<StepFrame>,
  /** Every place in the order the keyboard walks them, as the pointer finds each. */
  aims: () => readonly StepAim[],
) {
  /** The order of the place the pointer at `x` across the window points at, or null. */
  function placeAt(x: number): number | null {
    const box = field.value?.getBoundingClientRect()
    const layer = hover.value?.getBoundingClientRect()
    if (!box || !layer) return null
    const radius = Math.max(0, (layer.width - box.width) / 2)
    return aimAt(frame.value, aims(), x - box.left, { radius, width: box.width })
  }

  /** The stop the pointer at `x` points at, whose hint shows. */
  function pickAt(x: number) {
    const index = placeAt(x)
    return index === null
      ? null
      : (field.value?.querySelector<HTMLElement>(`[data-stop="${index}"]`) ?? null)
  }

  return { pickAt, placeAt }
}
