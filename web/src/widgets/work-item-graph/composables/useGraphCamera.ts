/**
 * Where the field's camera stands, and how the field reads at that distance.
 *
 * Vue Flow owns the viewport and its math; this decides when the camera is
 * placed — once when a projection first settles, again when the scope, the
 * filters or the field's size change, never on a refresh of the same field —
 * and what it is placed around (`graphCameraView`). The nodes stay hidden until
 * that first placement, so the field settles into a graph rather than flashing
 * oversized cards.
 *
 * The field's own chrome lies on it — the key along the top, the controls along
 * the bottom — so every framing keeps the nodes clear of both.
 */

import { computed, nextTick, onBeforeUnmount, ref, useTemplateRef, watch } from 'vue'
import type { ComponentPublicInstance, Ref, WatchSource } from 'vue'

import { useVueFlow } from '@vue-flow/core'
import { useElementSize } from '@vueuse/core'

import { graphCameraView } from '@/widgets/work-item-graph/utils/graphCamera.ts'
import {
  GRAPH_CONTROLS_BAND,
  graphFitViewOptions,
} from '@/widgets/work-item-graph/utils/graphLayout.ts'
import type { GraphLayout } from '@/widgets/work-item-graph/utils/graphLayout.ts'

/** The key's distance from the field's top edge, as `--space-3` places it. */
const LEGEND_OFFSET = 12
/** The controls' distance from the field's bottom edge, as `--space-4` places them. */
const CONTROLS_OFFSET = 16

/**
 * Below this zoom a card's words are too small to read, so each node is drawn
 * as its state's colour and its reference instead: «Fit whole graph» on a long
 * chain is then a map of where the work stands, not a grid of grey specks.
 */
const OVERVIEW_ZOOM = 0.5

interface CameraInput {
  /** The Vue Flow store this field's canvas and controls share. */
  flowId: string
  placed: Ref<GraphLayout | null>
  readyIds: Ref<Set<string>>
  /** Changes that make a new field rather than a refresh of this one. */
  resets: WatchSource[]
  /** The chain's root, which the camera starts on, in chain scope. */
  rootId: () => string | null
  selectedId: () => string | null
}

export function useGraphCamera(input: CameraInput) {
  const { dimensions, setViewport, viewport } = useVueFlow({ id: input.flowId })
  const flowReady = ref(false)
  const fitted = ref(false)
  let cameraRequest = 0
  onBeforeUnmount(() => {
    cameraRequest += 1
  })

  /**
   * Where the key is drawn (`ref="legendPlace"`) and the controls stand
   * (`ref="controls"`): their heights are what a framing keeps clear, measured
   * because both wrap on a narrow field.
   */
  const legendPlace = useTemplateRef<HTMLElement>('legendPlace')
  const controls = useTemplateRef<ComponentPublicInstance>('controls')
  const box = { box: 'border-box' } as const
  const { height: legendHeight } = useElementSize(legendPlace, undefined, box)
  const { height: controlsHeight } = useElementSize(
    () => controls.value?.$el as HTMLElement | undefined,
    undefined,
    box,
  )
  const insets = computed(() => ({
    top: legendHeight.value ? legendHeight.value + LEGEND_OFFSET : 0,
    bottom: controlsHeight.value ? controlsHeight.value + CONTROLS_OFFSET : GRAPH_CONTROLS_BAND,
  }))

  function scheduleFitView(focusOnly = false) {
    if (!flowReady.value || (fitted.value && !focusOnly)) return
    const request = ++cameraRequest
    void nextTick(async () => {
      const placed = input.placed.value
      if (!flowReady.value || request !== cameraRequest || !placed) return
      const camera = graphCameraView(placed, dimensions.value, input.readyIds.value, {
        selectedId: input.selectedId(),
        rootId: input.rootId(),
        insets: insets.value,
        focusOnly,
      })
      if (!camera) return
      const positioned = await setViewport(camera, { duration: 0 })
      if (request === cameraRequest && positioned) fitted.value = true
    })
  }

  function refit() {
    fitted.value = false
    scheduleFitView()
  }

  // Filter projections replace nodes while the initialized Vue Flow canvas stays mounted.
  watch(input.placed, (projection) => {
    if (projection) {
      scheduleFitView()
      return
    }
    cameraRequest += 1
    fitted.value = false
  })
  watch(
    [
      () => dimensions.value.width,
      () => dimensions.value.height,
      () => insets.value.top,
      () => insets.value.bottom,
    ],
    refit,
  )
  watch(input.resets, refit)

  return {
    fitted,
    /** «Fit whole graph», framed clear of the field's chrome. */
    fitOptions: computed(() => graphFitViewOptions(insets.value)),
    overview: computed(() => (viewport?.value.zoom ?? 1) < OVERVIEW_ZOOM),
    onFlowInit: () => {
      flowReady.value = true
      scheduleFitView()
    },
    /** Frame the field again; `focusOnly` is «Focus work», which goes to workable work. */
    scheduleFitView,
  }
}
