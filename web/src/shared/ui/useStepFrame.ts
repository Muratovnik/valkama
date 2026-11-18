/**
 * A frame along a step line (`StepLine`), dragged with a mouse or a pen or stretched from the
 * keyboard (`useAxisFrame`, `useKeyFrame`), as the line draws it and the moments it narrows the
 * line to: a dragged frame covers the moments its ends stand at in the span shown, a stretched one
 * the places it reaches, from the start of the first to the end of the last (`coveredBy`).
 */
import { computed } from 'vue'
import type { ComputedRef, Ref } from 'vue'

import { useAxisFrame, useKeyFrame } from '@/shared/ui/useAxisFrame.ts'
import { STEP_WIDTH, stepX } from '@/shared/ui/windowGeometry.ts'
import type { StepFrame, StepSpan } from '@/shared/ui/windowGeometry.ts'

/** A frame across the plot between `one` and `other` of `width`: its start and size, as shares of its box. */
const spanStyle = (one: number, other: number, width: number) => ({
  start: `${(Math.min(one, other) / width) * 100}%`,
  size: `${(Math.abs(other - one) / width) * 100}%`,
})

export function useStepFrame(
  field: Ref<HTMLElement | null>,
  line: {
    frame: ComputedRef<StepFrame>
    /** The moments a place covers, by its order. */
    coveredBy: (index: number) => StepSpan | null
    /** Narrows the line to the moments a frame covers. */
    narrow: (span: StepSpan | null) => void
  },
) {
  const { coveredBy, frame } = line

  /** The moments a frame from `start` to `end` pixels into the plot covers. */
  function spanOf(start: number, end: number): StepSpan {
    const width = field.value?.clientWidth || 1
    const { from, to } = frame.value
    return { from: from + (start / width) * (to - from), to: from + (end / width) * (to - from) }
  }

  /** The moments the places from `first` to `last` cover, from the first's start to the last's end. */
  function placesSpan(first: number, last: number): StepSpan | null {
    const start = coveredBy(first)
    const ends = coveredBy(last)
    return start && ends ? { from: start.from, to: ends.to } : null
  }

  const { drawn } = useAxisFrame(field, (start, end) => line.narrow(spanOf(start, end)))
  const keys = useKeyFrame(field, (first, last) => line.narrow(placesSpan(first, last)))

  /** Where the frame stands while it is drawn or stretched; none otherwise. */
  const framing = computed(() => {
    const pointer = drawn.value
    const width = field.value?.clientWidth || 1
    if (pointer) return spanStyle(pointer.from, pointer.to, width)
    const stretched = keys.stretched.value
    const [first, last] = stretched
      ? [stretched.anchor, stretched.reached].sort((a, b) => a - b)
      : []
    const covered = first === undefined || last === undefined ? null : placesSpan(first, last)
    return covered
      ? spanStyle(stepX(frame.value, covered.from), stepX(frame.value, covered.to), STEP_WIDTH)
      : null
  })

  return { framing, keys }
}
