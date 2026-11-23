/**
 * Which span of its windows a step line shows: the whole span, from its first window's start to the
 * current window's reset, running or past its reset alike. A frame narrows the line to the moments
 * it covers (`narrow`) until the reader takes it back to the whole span (`back`). The span is the
 * line's own: nothing else on the page reads it, and it outlasts a new answer for the same window,
 * but not a whole span it no longer touches, as a new period's may be.
 *
 * A running window once opened on its start to now and a third of that past it, with a switch to
 * the whole window: what «now» and which window the switch meant went unsaid, and two lines side by
 * side stood at different heights for the switch one had and the other lacked.
 */
import { computed, ref, watch } from 'vue'

import type { StepSpan } from '@/shared/ui/windowGeometry.ts'

export function useStepSpan(window: () => { from: number; to: number }) {
  /** The moments a frame narrowed the line to, until the reader takes it back. */
  const framed = ref<StepSpan | null>(null)

  const whole = computed<StepSpan>(() => ({ from: window().from, to: window().to }))
  const shown = computed<StepSpan>(() => framed.value ?? whole.value)

  /** The line narrowed to a frame's moments; a frame with no length narrows nothing. */
  function narrow(span: StepSpan | null) {
    if (span && span.to > span.from) framed.value = span
  }

  /** The line back on its whole span. */
  function back() {
    framed.value = null
  }

  watch(whole, (span) => {
    const frame = framed.value
    if (frame && (frame.to <= span.from || frame.from >= span.to)) back()
  })

  return { back, framed, narrow, shown, whole }
}
