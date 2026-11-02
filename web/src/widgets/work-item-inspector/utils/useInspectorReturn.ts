import { computed, nextTick, ref, watch } from 'vue'
import type { Ref } from 'vue'

import { useTimeoutFn } from '@vueuse/core'

import type {
  ChainView,
  InspectorReturn,
} from '@/widgets/work-item-inspector/utils/inspectorReturn.ts'

import type { ChainScope } from '@/shared/api/planningChainApi.ts'

interface Scroller {
  position(): InspectorReturn['scroll']
  restore(at: InspectorReturn['scroll']): void
}

/**
 * How long a card coming back stands unpainted for its chain: about what a normal read
 * takes. The record is in hand by then, and the chain is one section of it.
 */
const HOLD_MS = 250

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
  /** The record has answered, so the card has something to show. */
  read: () => boolean
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
 *
 * Until it has, `holding` says so: the card has a place to go to, and whatever it would
 * show before that stands somewhere else and jumps. That holds for a moment and no more.
 * A chain that has not answered by then may never answer, and the card was an empty panel
 * for as long as it took, so the card shows and goes as far down as it can without it. If
 * the chain does answer, it moves once to the place, unless the reader has moved on.
 */
export function useInspectorReturn(options: ReturnOptions) {
  const point = options.returnTo?.reference === options.reference() ? options.returnTo : null
  if (point) {
    options.section.value = point.section
    if (point.chain) options.scope.value = point.chain.scope
  }

  const restoring = ref((point?.scroll ?? 0) > 0)
  const holding = computed(() => restoring.value && options.read())

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
    try {
      await nextTick()
      const chain = options.chain.value
      if (at.chain && chain) await chain.restore(at.chain)
      const row = chain ? await chain.reveal(at.opened) : null
      options.frame.value?.restore(at.scroll)
      if (!row) return
      row.focus({ preventScroll: true })
      row.scrollIntoView({ block: 'nearest' })
    } finally {
      restoring.value = false
    }
  }

  if (point) {
    let applied = false
    let shownEarly: { focus: Element | null; place: number } | null = null
    const { start, stop } = useTimeoutFn(
      () => {
        options.frame.value?.restore(point.scroll)
        shownEarly = {
          focus: document.activeElement,
          place: options.frame.value?.position() ?? 0,
        }
        restoring.value = false
      },
      HOLD_MS,
      { immediate: false },
    )
    watch(
      options.read,
      (read) => {
        if (read && !applied) start()
      },
      { flush: 'post', immediate: true },
    )
    watch(
      options.settled,
      (settled) => {
        if (!settled || applied) return
        applied = true
        stop()
        const untouched =
          shownEarly === null ||
          (shownEarly.place === options.frame.value?.position() &&
            shownEarly.focus === document.activeElement)
        if (untouched) void apply(point)
      },
      { flush: 'post', immediate: true },
    )
  }

  return { capture, holding }
}
