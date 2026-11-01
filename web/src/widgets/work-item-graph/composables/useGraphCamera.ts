/**
 * Where the field's camera stands, and how the field reads at that distance.
 *
 * Vue Flow owns the viewport and its math; this decides when the camera moves,
 * and `graphCameraMove` decides where. The camera is the operator's: it is
 * placed when a scope opens, and after that a refresh never moves it, while a
 * new queue, search or switch, or a field that changed size, moves it only
 * when nothing drawn is left in sight — across, at the operator's zoom. The
 * nodes stay hidden until the first placement, so the field settles into a
 * graph rather than flashing oversized cards.
 *
 * Leaving the graph for the board and coming back keeps the camera: the field
 * unmounts with its view, so the last camera is held here by scope and given
 * back to a field that opens on the same one.
 *
 * The field's own chrome — the key above it, the controls below — stands in
 * strips of its own outside the flow, so no framing and no pan can put a node
 * under either.
 */

import { computed, nextTick, onBeforeUnmount, ref, toValue, watch } from 'vue'
import type { Ref, WatchSource } from 'vue'

import { useVueFlow } from '@vue-flow/core'
import type { ViewportTransform } from '@vue-flow/core'

import { graphAnchor, graphCameraMove } from '@/widgets/work-item-graph/utils/graphCamera.ts'
import type {
  GraphBranchFrame,
  GraphCameraCause,
} from '@/widgets/work-item-graph/utils/graphCamera.ts'
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

/**
 * The last camera a field stood at, and the scope it stood on. Module-level on
 * purpose: one field is drawn at a time, and it unmounts whenever the operator
 * switches to the board or the list, which would otherwise forget the camera
 * and frame the field afresh on the way back.
 */
let heldCamera: { scope: string; viewport: ViewportTransform } | null = null

interface CameraInput {
  /** The Vue Flow store this field's canvas and controls share. */
  flowId: string
  /**
   * Changes that narrow the same field anew: the queue, the search, the
   * switches. The field stays drawn while it is laid out again, and the camera
   * stays where it is unless nothing of the new layout is left in sight.
   */
  narrowings: WatchSource[]
  placed: Ref<GraphLayout | null>
  /** Changes that open a different scope rather than a new reading of this one. */
  scopes: WatchSource[]
  /** The branch of the chain the card chose, which the camera frames whole. */
  branch: () => GraphBranchFrame | null
  /** The chain's root, which the camera starts on, in chain scope. */
  rootId: () => string | null
  selectedId: () => string | null
}

export function useGraphCamera(input: CameraInput) {
  const { dimensions, setViewport, viewport } = useVueFlow({ id: input.flowId })
  const flowReady = ref(false)
  const fitted = ref(false)
  let cameraRequest = 0
  const scopeKey = () => JSON.stringify(input.scopes.map((source) => toValue(source)))
  onBeforeUnmount(() => {
    cameraRequest += 1
    if (fitted.value) heldCamera = { scope: scopeKey(), viewport: { ...viewport.value } }
  })

  /**
   * Where the camera goes for `cause`. Until the field is first placed every
   * cause is an opening, and the camera held for this scope, if any, is the
   * opening it returns to — moved across only if nothing is left in its sight.
   */
  function destination(cause: GraphCameraCause, placed: GraphLayout) {
    const opening = !fitted.value
    const held = opening && heldCamera?.scope === scopeKey() ? heldCamera.viewport : null
    if (held)
      return (
        graphCameraMove('resized', placed, { camera: held, dimensions: dimensions.value }) ?? held
      )
    return graphCameraMove(
      opening ? 'open' : cause,
      placed,
      { camera: viewport.value, dimensions: dimensions.value },
      { branch: input.branch(), selectedId: input.selectedId(), rootId: input.rootId() },
    )
  }

  /** Put the camera where `cause` sends it, once the DOM has the projection. */
  function place(cause: GraphCameraCause) {
    if (!flowReady.value) return
    const request = ++cameraRequest
    void nextTick(async () => {
      const placed = input.placed.value
      if (!flowReady.value || request !== cameraRequest || !placed) return
      const target = destination(cause, placed)
      if (!target) return
      const positioned = await setViewport(target, { duration: 0 })
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

  /** A different scope: the camera it held for the last one means nothing here. */
  function open() {
    heldCamera = null
    fitted.value = false
    place('open')
  }

  let narrowed = false
  watch(input.narrowings, () => {
    narrowed = true
  })
  // A narrowing lays the field out again while the initialized Vue Flow canvas
  // stays mounted, and the projection is briefly absent while it does; neither
  // forgets where the camera stands.
  watch(input.placed, (projection) => {
    if (!projection) return
    place(narrowed ? 'narrowed' : 'refresh')
    narrowed = false
  })
  watch([() => dimensions.value.width, () => dimensions.value.height], () => place('resized'))
  watch(input.scopes, open)

  return {
    fitted,
    /** The node a framing is placed around, which the keyboard enters the field on. */
    anchorId: computed(() => {
      const placed = input.placed.value
      if (!placed) return null
      const options = {
        branch: input.branch(),
        selectedId: input.selectedId(),
        rootId: input.rootId(),
      }
      return graphAnchor(placed, options)?.work_item_id ?? null
    }),
    /** «Fit whole graph». */
    fitOptions: graphFitViewOptions(),
    overview: computed(() => (viewport?.value.zoom ?? 1) < OVERVIEW_ZOOM),
    onFlowInit: () => {
      flowReady.value = true
      place('open')
    },
    reveal,
  }
}
