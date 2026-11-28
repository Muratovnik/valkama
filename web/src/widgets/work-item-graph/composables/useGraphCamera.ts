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
 * The farthest out the camera goes is the field's whole view, for the drawing and
 * the size it has now (`minZoom`). Past it a header is a pixel or two and the map a
 * smudge. Vue Flow holds the button, the wheel and a pinch to that limit, and a move
 * that leaves the camera past it brings it back. On a phone-wide field the whole view
 * goes no further out than its cards read (`fieldZoomFloor`).
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
  graphChosen,
  graphWholeView,
  headerOnScreen,
  zoomGivenBack,
  zoomTaken,
} from '@/widgets/work-item-graph/utils/graphCamera.ts'
import type {
  GraphBranchFrame,
  GraphCameraCause,
  GraphFieldSize,
  HeldFrame,
  TakenZoom,
} from '@/widgets/work-item-graph/utils/graphCamera.ts'
import { FRAME_GAP, GRAPH_ZOOM_MIN } from '@/widgets/work-item-graph/utils/graphLayout.ts'
import type { GraphLayout } from '@/widgets/work-item-graph/utils/graphLayout.ts'
import { revealView } from '@/widgets/work-item-graph/utils/graphReveal.ts'
import type { Box } from '@/widgets/work-item-graph/utils/graphWalk.ts'
import { fieldZoomFloor } from '@/widgets/work-item-graph/utils/graphZoomFloor.ts'

/**
 * Below this zoom a card's words are too small to read, so each node is drawn
 * as its state's colour and its reference instead: «Fit whole graph» on a long
 * chain is then a map of where the work stands, not a grid of grey specks.
 */
const OVERVIEW_ZOOM = 0.5
/** Below this the overview's grown words are under 10px on a screen, so a header says less, larger. */
const FAR_ZOOM = 0.25

/**
 * Below this zoom a comet's stroke would thin under a pixel and a half on screen, and the
 * work on a line would stop showing with no sign that it had. The field's lines may fade
 * out there and it may not, so the stroke keeps that width while the dash shrinks with
 * the field, which leaves a dot moving along the line at the farthest zoom.
 */
const COMET_STROKE_HOLDS_ZOOM = 0.625

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
  const { dimensions, setViewport, viewport, vueFlowRef } = useVueFlow({ id: input.flowId })
  /** The field's size and its floor, read together: a width that crosses a phone's moves both. */
  const field = (): GraphFieldSize => ({
    ...dimensions.value,
    floor: fieldZoomFloor(vueFlowRef.value),
  })
  const flowReady = ref(false)
  const fitted = ref(false)
  let cameraRequest = 0
  /** The operator's zoom the last fold took, given back when that frame opens again. */
  let taken: TakenZoom | null = null
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
      return graphCameraMove('resized', placed, { camera: held, dimensions: field() }) ?? held
    return graphCameraMove(
      opening ? 'open' : cause,
      placed,
      { camera: viewport.value, dimensions: field(), held: frame },
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
      const before = { ...viewport.value }
      const positioned = await setViewport(target, { duration: 0 })
      if (request !== cameraRequest || !positioned) return
      fitted.value = true
      if (cause === 'toggled' && frame)
        taken = zoomTaken(frame.frameId, before, { ...viewport.value })
    })
  }

  /** Bring one target into sight when the keyboard reaches it (`revealView`). */
  function reveal(node: Box, margin = FRAME_GAP) {
    const target = revealView(node, viewport.value, dimensions.value, margin)
    if (target) void setViewport(target, { duration: 0 })
  }

  /** A different scope: the camera it held for the last one means nothing here. */
  function open() {
    heldCamera = null
    taken = null
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
   * at the same zoom, so the header stays under the hand that pressed it — or at
   * the zoom this frame's fold took, which it gives back as it opens, while the
   * camera stands where that fold left it. Any fold or opening ends that memory,
   * and only a fold that raises the zoom starts it again.
   */
  function holdFrame(frameId: string) {
    const placed = input.placed.value
    const screen = placed ? headerOnScreen(placed, frameId, viewport.value) : null
    const zoom = zoomGivenBack(taken, frameId, viewport.value)
    taken = null
    held = screen ? { frameId, screen, ...(zoom === undefined ? {} : { zoom }) } : null
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

  /**
   * The whole view's zoom. It keeps its last value while the projection is absent during
   * a layout, or the field has no size, so the limit does not drop and come back.
   */
  const minZoom = computed<number>((last) => {
    const placed = input.placed.value
    const whole = placed && graphWholeView(placed, field())
    return whole?.zoom ?? last ?? GRAPH_ZOOM_MIN
  })

  const anchorOptions = () => ({
    branch: input.branch(),
    selectedId: input.selectedId(),
    rootId: input.rootId(),
  })

  /** «Fit whole graph»: set outright, so the limit, which is only as new as the last draw, cannot hold it. */
  function fitWhole() {
    const placed = input.placed.value
    const whole = placed && graphWholeView(placed, field())
    if (whole) void setViewport(whole, { duration: 0 })
  }

  /** Zoomed out past reading: cards are blocks and headers bands, their folds hidden. */
  const overview = computed(() => (viewport?.value.zoom ?? 1) < OVERVIEW_ZOOM)
  const far = computed(() => (viewport?.value.zoom ?? 1) < FAR_ZOOM)
  /** Unchanged above the zoom that matters, so zooming there restyles nothing. */
  const cometStrokeScale = computed(() =>
    Math.max(1, COMET_STROKE_HOLDS_ZOOM / (viewport?.value.zoom ?? 1)),
  )

  return {
    cometStrokeScale,
    fitted,
    /**
     * The target the keyboard enters the field on: once the camera is placed,
     * the one in sight where the operator is looking (`graphAnchor`).
     */
    anchorId: computed(() => {
      const placed = input.placed.value
      if (!placed) return null
      const sight = fitted.value
        ? { camera: viewport.value, dimensions: dimensions.value, overview: overview.value }
        : null
      return graphAnchor(placed, anchorOptions(), sight)?.id ?? null
    }),
    /**
     * The target focus takes when the field arrives where the host asked: what was asked
     * for (`graphChosen`), else the target the keyboard enters on.
     */
    arrivalId: computed(() => {
      const placed = input.placed.value
      const chosen = placed ? graphChosen(placed, anchorOptions(), overview.value) : undefined
      return chosen?.id ?? null
    }),
    far,
    fitWhole,
    holdFrame,
    minZoom,
    overview,
    onFlowInit: () => {
      flowReady.value = true
      place('open')
    },
    reveal,
  }
}
