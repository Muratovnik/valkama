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

import {
  graphAnchor,
  graphCameraMove,
  headerOnScreen,
} from '@/widgets/work-item-graph/utils/graphCamera.ts'
import type {
  GraphBranchFrame,
  GraphCameraCause,
  HeldFrame,
} from '@/widgets/work-item-graph/utils/graphCamera.ts'
import { FRAME_GAP, graphFitViewOptions } from '@/widgets/work-item-graph/utils/graphLayout.ts'
import type { GraphLayout } from '@/widgets/work-item-graph/utils/graphLayout.ts'
import { nodeCentre } from '@/widgets/work-item-graph/utils/graphWalk.ts'
import type { Box } from '@/widgets/work-item-graph/utils/graphWalk.ts'

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
  function destination(cause: GraphCameraCause, placed: GraphLayout, frame: HeldFrame | null) {
    const opening = !fitted.value
    const held = opening && heldCamera?.scope === scopeKey() ? heldCamera.viewport : null
    if (held)
      return (
        graphCameraMove('resized', placed, { camera: held, dimensions: dimensions.value }) ?? held
      )
    return graphCameraMove(
      opening ? 'open' : cause,
      placed,
      { camera: viewport.value, dimensions: dimensions.value, held: frame },
      { branch: input.branch(), selectedId: input.selectedId(), rootId: input.rootId() },
    )
  }

  /** Put the camera where `cause` sends it, once the DOM has the projection. */
  function place(cause: GraphCameraCause, frame: HeldFrame | null = null) {
    if (!flowReady.value) return
    const request = ++cameraRequest
    void nextTick(async () => {
      const placed = input.placed.value
      if (!flowReady.value || request !== cameraRequest || !placed) return
      const target = destination(cause, placed, frame)
      if (!target) return
      const positioned = await setViewport(target, { duration: 0 })
      if (request === cameraRequest && positioned) fitted.value = true
    })
  }

  /**
   * Bring one target into sight when the keyboard reaches it, at the zoom the
   * operator chose: a target already in view, `margin` clear of the flow's
   * edges, leaves the camera where it is; any other is centred.
   */
  function reveal(node: Box, margin = FRAME_GAP) {
    const { x, y, zoom } = viewport.value
    const { width, height } = dimensions.value
    const left = node.x * zoom + x
    const top = node.y * zoom + y
    const inView =
      left >= margin &&
      top >= margin &&
      left + node.width * zoom <= width - margin &&
      top + node.height * zoom <= height - margin
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
  /** The frame the operator is folding or opening, and where its header stood on the screen. */
  let held: HeldFrame | null = null
  /**
   * Hold a frame's header where it stands on the screen while the frame folds
   * or opens; call it before the fold. The next layout moves the camera across,
   * at the same zoom, so the header stays under the hand that pressed it.
   */
  function holdFrame(frameId: string) {
    const placed = input.placed.value
    const screen = placed ? headerOnScreen(placed, frameId, viewport.value) : null
    held = screen ? { frameId, screen } : null
  }
  // A narrowing lays the field out again while the initialized Vue Flow canvas
  // stays mounted, and the projection is briefly absent while it does; neither
  // forgets where the camera stands.
  watch(input.placed, (projection) => {
    if (!projection) return
    if (held) place('toggled', held)
    else place(narrowed ? 'narrowed' : 'refresh')
    held = null
    narrowed = false
  })
  watch([() => dimensions.value.width, () => dimensions.value.height], () => place('resized'))
  watch(input.scopes, open)

  return {
    fitted,
    /**
     * The target the keyboard enters the field on: once the camera is placed,
     * the one in sight where the operator is looking (`graphAnchor`).
     */
    anchorId: computed(() => {
      const placed = input.placed.value
      if (!placed) return null
      const options = {
        branch: input.branch(),
        selectedId: input.selectedId(),
        rootId: input.rootId(),
      }
      const sight = fitted.value ? { camera: viewport.value, dimensions: dimensions.value } : null
      return graphAnchor(placed, options, sight)?.id ?? null
    }),
    /** «Fit whole graph». */
    fitOptions: graphFitViewOptions(),
    holdFrame,
    overview: computed(() => (viewport?.value.zoom ?? 1) < OVERVIEW_ZOOM),
    onFlowInit: () => {
      flowReady.value = true
      place('open')
    },
    reveal,
  }
}
