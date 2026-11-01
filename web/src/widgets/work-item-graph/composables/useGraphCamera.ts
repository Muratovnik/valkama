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
 * The field's own chrome — the key above it, the controls below — stands in
 * strips of its own outside the flow, so no framing and no pan can put a node
 * under either.
 */

import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import type { Ref, WatchSource } from 'vue'

import { useVueFlow } from '@vue-flow/core'

import { graphAnchor, graphCameraView } from '@/widgets/work-item-graph/utils/graphCamera.ts'
import { NODE_HEIGHT, NODE_WIDTH } from '@/widgets/work-item-graph/utils/graphGeometry.ts'
import type { PlacedNode } from '@/widgets/work-item-graph/utils/graphGeometry.ts'
import { FRAME_GAP, graphFitViewOptions } from '@/widgets/work-item-graph/utils/graphLayout.ts'
import type { GraphLayout } from '@/widgets/work-item-graph/utils/graphLayout.ts'
import { nodeCentre } from '@/widgets/work-item-graph/utils/graphWalk.ts'

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

  function scheduleFitView(focusOnly = false) {
    if (!flowReady.value || (fitted.value && !focusOnly)) return
    const request = ++cameraRequest
    void nextTick(async () => {
      const placed = input.placed.value
      if (!flowReady.value || request !== cameraRequest || !placed) return
      const camera = graphCameraView(placed, dimensions.value, input.readyIds.value, {
        selectedId: input.selectedId(),
        rootId: input.rootId(),
        focusOnly,
      })
      if (!camera) return
      const positioned = await setViewport(camera, { duration: 0 })
      if (request === cameraRequest && positioned) fitted.value = true
    })
  }

  /**
   * Bring one node into sight when the keyboard reaches it, at the zoom the
   * operator chose: a node already in view, `margin` clear of the flow's
   * edges, leaves the camera where it is; any other is centred.
   */
  function reveal(node: PlacedNode, margin = FRAME_GAP) {
    const { x, y, zoom } = viewport.value
    const { width, height } = dimensions.value
    const left = node.x * zoom + x
    const top = node.y * zoom + y
    const inView =
      left >= margin &&
      top >= margin &&
      left + NODE_WIDTH * zoom <= width - margin &&
      top + NODE_HEIGHT * zoom <= height - margin
    if (inView) return
    const centre = nodeCentre(node)
    void setViewport(
      { x: width / 2 - centre.x * zoom, y: height / 2 - centre.y * zoom, zoom },
      { duration: 0 },
    )
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
  watch([() => dimensions.value.width, () => dimensions.value.height], refit)
  watch(input.resets, refit)

  return {
    fitted,
    /** The node a framing is placed around, which the keyboard enters the field on. */
    anchorId: computed(() => {
      const placed = input.placed.value
      if (!placed) return null
      const options = { selectedId: input.selectedId(), rootId: input.rootId() }
      return graphAnchor(placed, input.readyIds.value, options)?.work_item_id ?? null
    }),
    /** «Fit whole graph». */
    fitOptions: graphFitViewOptions(),
    overview: computed(() => (viewport?.value.zoom ?? 1) < OVERVIEW_ZOOM),
    onFlowInit: () => {
      flowReady.value = true
      scheduleFitView()
    },
    /** Frame the field again; `focusOnly` is «Focus work», which goes to workable work. */
    scheduleFitView,
    reveal,
  }
}
