/**
 * Which span of its window a step line shows: the whole window, from its start to its reset,
 * running or past its reset alike. A frame narrows the line to the moments it covers (`narrow`)
 * until the reader takes it back to the whole window (`back`). The span is the line's own: nothing
 * else on the page reads it, and it outlasts a new answer for the same window.
 *
 * A running window once opened on its start to now and a third of that past it, with a switch to
 * the whole window: what «now» and which window the switch meant went unsaid, and two lines side by
 * side stood at different heights for the switch one had and the other lacked.
 */
import { computed, ref } from 'vue'

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

  /** The line back on its whole window. */
  function back() {
    framed.value = null
  }

  return { back, framed, narrow, shown, whole }
}
