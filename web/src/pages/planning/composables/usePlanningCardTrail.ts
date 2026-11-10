import { computed, ref } from 'vue'

import type { InspectorReturn } from '@/widgets/work-item-inspector/utils/inspectorReturn.ts'

interface TrailOptions {
  /** The reference of the card the route has open, if any. */
  open: () => string | null
  /** Route to one item of the space, or back to the space itself. */
  show: (reference: string | null) => void
}

/**
 * The cards the operator walked through to reach the open one, for the card's Back.
 *
 * The route holds the open item's identity; this holds the depth, which no address
 * says. Each step also holds where its card was left, which the card hands over as
 * it opens another, so Back reopens it there and not at its top.
 */
export function usePlanningCardTrail(options: TrailOptions) {
  const trail = ref<{ left: InspectorReturn | null; reference: string }[]>([])
  /** Where the card Back is reopening was left; read by that card alone. */
  const returning = ref<InspectorReturn | null>(null)

  /** Forget the walk: the space changed, or the card closed. */
  function reset() {
    trail.value = []
    returning.value = null
  }

  /** Open a card; one opened from the open card adds that card to the trail. */
  function openItem(reference: string, related = false, left: InspectorReturn | null = null) {
    returning.value = null
    const from = options.open()
    if (related && from !== null && from !== reference)
      trail.value = [...trail.value, { reference: from, left }]
    options.show(reference)
  }

  function closeItem() {
    reset()
    options.show(null)
  }

  function goBack() {
    const previous = trail.value.at(-1)
    if (previous === undefined) return
    trail.value = trail.value.slice(0, -1)
    returning.value = previous.left
    options.show(previous.reference)
  }

  return {
    /** True once the operator reached this item from another one. */
    canGoBack: computed(() => trail.value.length > 0),
    closeItem,
    goBack,
    openItem,
    reset,
    returning,
  }
}
