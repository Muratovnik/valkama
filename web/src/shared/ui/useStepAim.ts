/**
 * Where the pointer stands among a step line's places (`StepLine`). One layer over the line's
 * field takes the pointer for every reading and place, half a mark past each edge of the field,
 * and finds the place under it by its x alone (`aimAt`): how far the layer runs past the field is
 * how near a mark the pointer finds that mark. The place found is the stop whose hint shows
 * (`vHintPick`) and whose mark the line paints.
 *
 * Which marks stand within that reach of each other (`near`) is read from the field and the layer
 * as they stand, again whenever either is resized: of two places that near the pointer finds the
 * nearer alone, so the line says the other's words in its hint.
 */
import { ref } from 'vue'
import type { ComputedRef, Ref } from 'vue'

import { useResizeObserver } from '@vueuse/core'

import { aimAt, marksNear } from '@/shared/ui/windowGeometry.ts'
import type { StepAim, StepFrame, StepReach } from '@/shared/ui/windowGeometry.ts'

export function useStepAim(
  /** The line's field, and the one layer that takes the pointer over it. */
  { field, hover }: { field: Ref<HTMLElement | null>; hover: Ref<HTMLElement | null> },
  frame: ComputedRef<StepFrame>,
  /** Every place in the order the keyboard walks them, as the pointer finds each. */
  aims: () => readonly StepAim[],
) {
  /** Where the field starts on the page, its width, and how far the layer runs past each edge. */
  function measure() {
    const box = field.value?.getBoundingClientRect()
    const layer = hover.value?.getBoundingClientRect()
    return box && layer
      ? { left: box.left, width: box.width, radius: Math.max(0, (layer.width - box.width) / 2) }
      : null
  }

  /** A mark's reach on the line as it stands, or null before it stands. */
  const reach = ref<StepReach | null>(null)
  const remeasure = () => {
    const found = measure()
    reach.value = found ? { radius: found.radius, width: found.width } : null
  }
  useResizeObserver(field, remeasure)
  useResizeObserver(hover, remeasure)

  /** The order of the place the pointer at `x` across the window points at, or null. */
  function placeAt(x: number): number | null {
    const found = measure()
    return found ? aimAt(frame.value, aims(), x - found.left, found) : null
  }

  /** The stop the pointer at `x` points at, whose hint shows. */
  function pickAt(x: number) {
    const index = placeAt(x)
    return index === null
      ? null
      : (field.value?.querySelector<HTMLElement>(`[data-stop="${index}"]`) ?? null)
  }

  /** Whether the marks of two moments stand within a mark's reach of each other. */
  const near = (one: number, other: number) =>
    reach.value !== null && marksNear(frame.value, one, other, reach.value)

  return { near, pickAt, placeAt }
}
