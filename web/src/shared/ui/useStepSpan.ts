/**
 * Which span of its window a step line shows. A running window opens on its start to now and the
 * forecast past it (`aheadSpan`), and its switch offers the whole window up to its reset; a window
 * past its reset has the whole window alone. A frame narrows the line to the moments it covers,
 * and either span chosen on the switch takes the frame back. The span is the line's own: nothing
 * else on the page reads it, and it outlasts a new answer for the same window.
 */
import { computed, ref } from 'vue'

import { aheadSpan } from '@/shared/ui/windowGeometry.ts'
import type { StepSpan } from '@/shared/ui/windowGeometry.ts'

/** The span a running window's switch chooses: to now and the forecast, or the whole window. */
export type StepScope = 'ahead' | 'whole'

export function useStepSpan(
  window: () => { end: number; from: number; to: number },
  words: () => { ahead: string; whole: string },
) {
  /** Whether the window still runs, so it has a span to now and the forecast besides the whole. */
  const running = computed(() => window().end < window().to)
  const scope = ref<StepScope>('ahead')
  /** The moments a frame narrowed the line to, until the switch takes it back. */
  const framed = ref<StepSpan | null>(null)

  const whole = computed<StepSpan>(() => ({ from: window().from, to: window().to }))
  const shown = computed<StepSpan>(() => {
    if (framed.value) return framed.value
    if (scope.value === 'whole' || !running.value) return whole.value
    return aheadSpan(window().from, window().to, window().end)
  })

  /** The switch's spans: both while the window runs, the whole alone once it has reset. */
  const options = computed(() => [
    ...(running.value ? [{ value: 'ahead' as const, label: words().ahead }] : []),
    { value: 'whole' as const, label: words().whole },
  ])
  /** The span the switch says is shown: none while a frame narrows the line. */
  const chosen = computed<StepScope | null>(() => {
    if (framed.value) return null
    return running.value ? scope.value : 'whole'
  })
  /** The switch stands while it has two spans to choose between, or a frame to take back. */
  const switched = computed(() => running.value || framed.value !== null)

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
