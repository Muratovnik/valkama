/**
 * Which span of its window a step line shows. A running window opens on its start to now and the
 * forecast past it (`aheadSpan`), and its switch offers the whole window up to its reset, while
 * that span ends before the reset: once three quarters of the window have passed, it is the whole
 * window, and a switch between two equal spans would change nothing. Such a window, one past its
 * reset, and one its host says has reset since it was read (`ended`) have the whole window alone,
 * though the last reading holds only to the moment it was read. A frame narrows the line to the
 * moments it covers, and the switch takes the frame back to the spans it offers. The span is the
 * line's own: nothing else on the page reads it, and it outlasts a new answer for the same window.
 */
import { computed, ref } from 'vue'

import { aheadSpan } from '@/shared/ui/windowGeometry.ts'
import type { StepSpan } from '@/shared/ui/windowGeometry.ts'

/** The span a running window's switch chooses: to now and the forecast, or the whole window. */
export type StepScope = 'ahead' | 'whole'

export function useStepSpan(
  window: () => { end: number; from: number; to: number; ended?: boolean },
  words: () => { ahead: string; whole: string },
) {
  /** The span to now and the forecast, where it is not the whole window: it ends before the reset. */
  const ahead = computed<StepSpan | null>(() => {
    const { end, ended, from, to } = window()
    if (ended) return null
    const span = aheadSpan(from, to, end)
    return span.to < to ? span : null
  })
  const scope = ref<StepScope>('ahead')
  /** The moments a frame narrowed the line to, until the switch takes it back. */
  const framed = ref<StepSpan | null>(null)

  const whole = computed<StepSpan>(() => ({ from: window().from, to: window().to }))
  const shown = computed<StepSpan>(() => {
    if (framed.value) return framed.value
    if (scope.value === 'whole' || !ahead.value) return whole.value
    return ahead.value
  })

  /** The switch's spans: both while the span to now and the forecast is not the whole, else the whole. */
  const options = computed(() => [
    ...(ahead.value ? [{ value: 'ahead' as const, label: words().ahead }] : []),
    { value: 'whole' as const, label: words().whole },
  ])
  /** The span the switch says is shown: none while a frame narrows the line. */
  const chosen = computed<StepScope | null>(() => {
    if (framed.value) return null
    return ahead.value ? scope.value : 'whole'
  })
  /** The switch stands while it has two spans to choose between, or a frame to take back. */
  const switched = computed(() => ahead.value !== null || framed.value !== null)

  function choose(next: StepScope) {
    scope.value = next
    framed.value = null
  }

  /** The line narrowed to a frame's moments; a frame with no length narrows nothing. */
  function narrow(span: StepSpan | null) {
    if (span && span.to > span.from) framed.value = span
  }

  return { choose, chosen, framed, narrow, options, shown, switched, whole }
}
