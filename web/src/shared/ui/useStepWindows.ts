/**
 * The windows a step line holds (`StepLine`): the current one, its own span inside the line's, or
 * the line's whole span where the host names none (`current`); the moments the count fell to
 * nothing between two of them (`restarts` marked `zero`); the line's two parts, the windows before
 * the current one and the current one (`stepParts`), its readings' line ending at `end`, or at the
 * last reading of a silent window; whether a reading is of a window before the current one; and
 * the pace, over the part of the current window the frame shows, drawn where the window has one
 * and its layer is on.
 */
import { computed } from 'vue'
import type { Ref } from 'vue'

import { evenAt, stepParts, stepX, stepY } from '@/shared/ui/windowGeometry.ts'
import type { StepFrame, StepPoint, StepRestart, StepSpan } from '@/shared/ui/windowGeometry.ts'

/** What of a step line its windows are read from. */
interface WindowsLine {
  end: number
  points: readonly StepPoint[]
  current?: StepSpan
  even?: boolean
  restarts?: readonly StepRestart[]
  silent?: boolean
}

export function useStepWindows(
  line: () => WindowsLine,
  frame: Ref<StepFrame>,
  { evenShown, whole }: { whole: Ref<StepSpan>; evenShown: () => boolean },
) {
  /** The current window: its own, or the line's span where the host names none. */
  const windowSpan = computed<StepSpan>(() => line().current ?? whole.value)
  /** The moments the count fell to nothing between two windows of the line, oldest first. */
  const zeros = computed(() =>
    (line().restarts ?? []).filter((restart) => restart.zero).map((restart) => restart.at),
  )
  /** The line's two parts: the windows before the current one, and the current one. */
  const path = computed(() => {
    const { end, points, silent } = line()
    return stepParts(frame.value, {
      end: silent ? (points.at(-1)?.at ?? end) : end,
      live: windowSpan.value.from,
      points,
      zeros: zeros.value,
    })
  })
  /** Whether a reading is of a window before the current one, drawn in the neutral ink. */
  const earlier = (point: Pick<StepPoint, 'at'>) => point.at < windowSpan.value.from
  /** Whether the pace is drawn: the window has one, its layer is on and the frame shows it. */
  const evenDrawn = computed(
    () =>
      Boolean(line().even) &&
      evenShown() &&
      windowSpan.value.from < frame.value.to &&
      windowSpan.value.to > frame.value.from,
  )
  /** The pace across the part of the current window shown: where steady use stands at its ends. */
  const evenLine = computed(() => {
    const from = Math.max(frame.value.from, windowSpan.value.from)
    const to = Math.min(frame.value.to, windowSpan.value.to)
    return {
      x1: stepX(frame.value, from),
      y1: stepY(frame.value, evenAt(windowSpan.value, from)),
      x2: stepX(frame.value, to),
      y2: stepY(frame.value, evenAt(windowSpan.value, to)),
    }
  })
  return { earlier, evenDrawn, evenLine, path, zeros }
}
