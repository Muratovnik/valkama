import { defineStore } from 'pinia'
import { computed, toValue } from 'vue'
import type { MaybeRefOrGetter } from 'vue'

import { useStorage } from '@vueuse/core'

/**
 * The layers a chart draws beside its data, which a reader turns off and on from its key in the
 * legend: the mark of the period compared with (`outline`), the line of a change at a period's
 * start (`change`), and on a window's step line where steady use would stand (`even`) and its
 * forecast (`ahead`). The data itself is no layer and always shows, so a column's sum never
 * disagrees with the figures beside it; nor is the hatch of a period still running, which is how
 * unfinished data is drawn, or a line's «now» and its top's level, which orient the plot.
 */
const LAYERS = ['outline', 'change', 'even', 'ahead'] as const
export type ChartLayer = (typeof LAYERS)[number]

const STORAGE_KEY = 'valkama-chart-layers'

/**
 * The layers a stored value hides: the layers it names, once each and in one order. Anything
 * else — a broken value, a layer no build draws, another shape — hides nothing, so every layer
 * shows again rather than a chart losing one the reader never turned off.
 */
function hiddenIn(raw: string): ChartLayer[] {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return []
  }
  return Array.isArray(value) ? LAYERS.filter((layer) => value.includes(layer)) : []
}

/**
 * Which layers show, one choice per layer for every chart on this computer: a layer turned off
 * on one chart is off on every chart that draws it, and stays off after a reload until it is
 * turned on again. A store, so every legend and chart on the page holds the same ref, as the
 * settings do (`settingsStore`); browser storage, as the board's folded lanes are kept
 * (`useLaneCollapse`). Storage that is missing or refuses a write keeps the choice for as long as
 * the page, which is all it loses. The legends write it; the charts read it.
 */
export const useChartLayersStore = defineStore('chartLayers', () => {
  const hidden = useStorage<ChartLayer[]>(
    STORAGE_KEY,
    [],
    typeof localStorage === 'undefined' ? undefined : localStorage,
    {
      serializer: { read: hiddenIn, write: (layers) => JSON.stringify(layers) },
      flush: 'sync',
      writeDefaults: false,
      onError() {
        // Storage that refuses a write keeps the choice for as long as the page.
      },
    },
  )

  /** Whether a layer is drawn: every layer is, until it is turned off. */
  const shown = (layer: ChartLayer) => !hidden.value.includes(layer)

  /** Turn a layer off where it shows, and on where it is off, on every chart at once. */
  function toggle(layer: ChartLayer) {
    hidden.value = shown(layer)
      ? LAYERS.filter((one) => one === layer || hidden.value.includes(one))
      : hidden.value.filter((one) => one !== layer)
  }

  return { shown, toggle }
})

/** One layer as its key and its chart read it: whether it shows, and the press that flips it. */
export function useChartLayer(layer: MaybeRefOrGetter<ChartLayer>) {
  const layers = useChartLayersStore()
  return {
    shown: computed(() => layers.shown(toValue(layer))),
    toggle: () => layers.toggle(toValue(layer)),
  }
}
