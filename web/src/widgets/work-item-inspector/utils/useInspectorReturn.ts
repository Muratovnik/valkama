import { computed, nextTick, ref, watch } from 'vue'
import type { Ref } from 'vue'

import { useEventListener, useTimeoutFn } from '@vueuse/core'

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
  /** The section's element, which a card opened on its own chain brings into view. */
  $el?: unknown
  restore(view: Omit<ChainView, 'scope'>): Promise<void>
  reveal(reference: string): Promise<HTMLElement | null>
  view(): Omit<ChainView, 'scope'>
}

/** What the card was opened with, read as the card's own props. */
interface CardOpening {
  readonly reference: string
  /** The address names the card's own chain, in this scope: the graph was asked for from here. */
  readonly ownChain?: ChainScope | null
  /** The point this card was opened to return to, if it was reached by Back. */
  readonly returnTo?: InspectorReturn | null
}

interface ReturnOptions {
  card: CardOpening
  chain: Ref<ChainReading | null>
  frame: Ref<Scroller | null>
  scope: Ref<ChainScope>
  section: Ref<string>
  /** The record has answered, so the card has something to show. */
  read: () => boolean
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
  const { card } = options
  const point = card.returnTo?.reference === card.reference ? card.returnTo : null
  if (point) {
    options.section.value = point.section
    if (point.chain) options.scope.value = point.chain.scope
  }

  if (!point && card.ownChain) openOnChain(card.ownChain)

  /**
   * Back after «Show on graph» is the card again, over the graph of its own chain, and it opens
   * where that graph was asked for: its Relations, the chain in the scope the graph drew and in
   * view once the card's answers are in. It reopened on Overview, a tab away from the chain.
   */
  function openOnChain(scope: ChainScope) {
    options.section.value = 'relations'
    options.scope.value = scope
    const stop = watch(
      options.settled,
      (settled) => {
        if (!settled) return
        stop()
        const shown = options.chain.value?.$el
        if (shown instanceof Element) shown.scrollIntoView({ block: 'nearest' })
      },
      { flush: 'post' },
    )
  }

  const restoring = ref((point?.scroll ?? 0) > 0)
  const holding = computed(() => restoring.value && options.read())

  function capture(opened: string): InspectorReturn {
    const chain = options.chain.value
    return {
      reference: card.reference,
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
    let shownEarly = false
    let movedOn = false
    // What the reader did, and not where the card stands: a chain arriving above what is on
    // screen moves the scroller by itself, because the browser keeps that in view.
    useEventListener(
      window,
      ['keydown', 'pointerdown', 'wheel'],
      () => {
        movedOn = shownEarly
      },
      { capture: true, passive: true },
    )
    const { start, stop } = useTimeoutFn(
      () => {
        options.frame.value?.restore(point.scroll)
        shownEarly = true
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
        if (!movedOn) void apply(point)
      },
      { flush: 'post', immediate: true },
    )
  }

  return { capture, holding }
}
