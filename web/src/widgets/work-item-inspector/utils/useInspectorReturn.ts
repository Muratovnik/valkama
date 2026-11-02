import { nextTick, watch } from 'vue'
import type { Ref } from 'vue'

import type {
  ChainView,
  InspectorReturn,
} from '@/widgets/work-item-inspector/utils/inspectorReturn.ts'

import type { ChainScope } from '@/shared/api/planningChainApi.ts'

interface Scroller {
  position(): InspectorReturn['scroll']
  restore(at: InspectorReturn['scroll']): void
}

interface ChainReading {
  restore(view: Omit<ChainView, 'scope'>): Promise<void>
  reveal(reference: string): Promise<HTMLElement | null>
  view(): Omit<ChainView, 'scope'>
}

interface ReturnOptions {
  chain: Ref<ChainReading | null>
  frame: Ref<Scroller | null>
  /** The point this card was opened to return to, if it was reached by Back. */
  returnTo: InspectorReturn | null
  scope: Ref<ChainScope>
  section: Ref<string>
  reference: () => string
  /** The item and its chain have both answered, so the body is as tall as it will be. */
  settled: () => boolean
}

/**
 * Leaving a card for another opened from it, and coming back to it by Back.
 *
 * Leaving reads where the card stands — the section, how far it was read, the
 * chain's scope, lane and open groups, and which card was opened. Coming back
 * puts all of it back once the card's answers are in, then focuses the row that
 * was opened. The parent used to reopen at its top, so walking a chain member
 * by member cost a scroll back down after every step.
 */
export function useInspectorReturn(options: ReturnOptions) {
  const point = options.returnTo?.reference === options.reference() ? options.returnTo : null
  if (point) {
    options.section.value = point.section
    if (point.chain) options.scope.value = point.chain.scope
  }

  function capture(opened: string): InspectorReturn {
    const chain = options.chain.value
    return {
      reference: options.reference(),
      section: options.section.value,
      scroll: options.frame.value?.position() ?? 0,
      opened,
      chain: chain ? { ...chain.view(), scope: options.scope.value } : null,
    }
  }

  async function apply(at: InspectorReturn) {
    await nextTick()
    const chain = options.chain.value
    if (at.chain && chain) await chain.restore(at.chain)
    const row = chain ? await chain.reveal(at.opened) : null
    options.frame.value?.restore(at.scroll)
    if (!row) return
    row.focus({ preventScroll: true })
    row.scrollIntoView({ block: 'nearest' })
  }

  if (point) {
    let applied = false
    watch(
      options.settled,
      (settled) => {
        if (!settled || applied) return
        applied = true
        void apply(point)
      },
      { flush: 'post', immediate: true },
    )
  }

  return { capture }
}
