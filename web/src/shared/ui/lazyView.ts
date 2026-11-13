/**
 * A view whose code downloads when it is first needed rather than with the shell.
 *
 * The first screen is the board, and it should not wait for code it does not
 * draw. A lazy view is that boundary, and it owns the three things a bare
 * `defineAsyncComponent` gets wrong here:
 *
 * - A fast download shows nothing at all, and a slow one shows the loading panel
 *   for long enough to be read: `loadingPresence` decides when, for this boundary
 *   as for every other wait.
 * - A failed download says so with the product's own failure panel and a Retry,
 *   rather than leaving the space blank. `defineAsyncComponent` keeps the
 *   rejected request and hands it to every later mount, so nothing short of a
 *   reload could ever try again.
 * - The download can start before the view is drawn: `prefetch` on intent, such
 *   as hovering the control that will open it, so the switch itself is instant,
 *   or `prefetchWhenIdle` once the first screen is drawn, for a view that is
 *   opened often but not on that screen.
 * - A template ref on the view reaches what the loaded component exposes, and
 *   nothing until its code is resident: a host types that ref as `Partial` of the
 *   component's instance and answers for a member that is not there yet.
 * - A view that draws its own frame around its own waits, as the card does, hands
 *   that frame over as `frame`, and the download's wait and failure stand in it: in
 *   the column the view's own wait will take, not a frame's inset outside it.
 *   The view takes the frame's place with new elements, so focus held in the frame
 *   falls to the page; a surface that holds the view is told, and puts it in again.
 *
 * The holder is module-level on purpose: the code is downloaded once per page,
 * so whether it is resident is one fact shared by every place that draws it.
 */
import { defineComponent, h, onBeforeUnmount, shallowRef } from 'vue'
import type { Component, ShallowRef, VNode } from 'vue'

import { uiError, uiLoading } from '@/shared/api/platformUiState.ts'
import type { PlatformUiState } from '@/shared/api/platformUiState.ts'
import { useLoadingPresence } from '@/shared/ui/loadingPresence.ts'
import PlatformStatePanel from '@/shared/ui/PlatformStatePanel.vue'
import { useContentReplaced } from '@/shared/ui/useOverlayFocus.ts'

const LOADING = uiLoading()
const FAILURE_REASON = 'platform.failures.viewDownloadFailed'

export interface LazyViewOptions {
  /**
   * What the download's wait and failure stand in, for a view that brings its own
   * frame: drawn from the first frame of the download with the props and listeners
   * the view is given, so it can show what the view's frame shows before its record
   * is read and answer the same close. The panel is its default slot.
   */
  frame?: Component
}

export interface LazyView<C extends Component> {
  /**
   * What a template renders in place of the eagerly imported component.
   *
   * Typed as that component, because it forwards every prop, listener and slot
   * to it unchanged; a template checks its bindings against the real contract.
   */
  readonly component: C
  /** True once the code is resident, so drawing the view cannot wait on the network. */
  readonly ready: Readonly<ShallowRef<boolean>>
  /** Download the code, sharing one request among every caller until it settles. */
  load: () => Promise<Component>
  /** Start the download for a view the operator is about to open. */
  prefetch: () => void
  /** Start the download once the page has nothing more urgent to do. */
  prefetchWhenIdle: () => void
}

/**
 * Run a task once the page is idle, so it does not compete with drawing the
 * screen it was asked from. A page without `requestIdleCallback` runs it after
 * the current task.
 */
function whenIdle(task: () => void) {
  if (typeof requestIdleCallback === 'function') requestIdleCallback(task)
  else setTimeout(task, 0)
}

/** Wrap a dynamic import as a view that loads on demand. */
export function lazyView<C extends Component>(
  loader: () => Promise<{ default: C }>,
  { frame }: LazyViewOptions = {},
): LazyView<C> {
  const ready = shallowRef(false)
  let resident: Component | null = null
  let pending: Promise<Component> | null = null
  /** When the download in flight began: the loading delay counts from here. */
  let pendingSince = 0

  function load(): Promise<Component> {
    if (resident !== null) return Promise.resolve(resident)
    if (pending !== null) return pending
    pendingSince = Date.now()
    // A failed request is forgotten, so the next caller asks the network again.
    pending = loader().then(
      (module) => {
        resident = module.default
        ready.value = true
        return module.default
      },
      (error: unknown) => {
        pending = null
        throw error
      },
    )
    return pending
  }

  function prefetch() {
    load().catch(() => {
      // Nobody is looking yet: the boundary that draws the view reports a failure.
    })
  }

  function prefetchWhenIdle() {
    if (resident === null && pending === null) whenIdle(prefetch)
  }

  const component = defineComponent({
    name: 'LazyView',
    inheritAttrs: false,
    setup(_props, { attrs, slots, expose }) {
      const view = shallowRef<Component | null>(resident)
      /** The loaded component's instance: a ref on this view reads its members through it. */
      const inner = shallowRef<object | null>(null)
      expose(
        new Proxy(
          {},
          {
            get: (_target, key) =>
              inner.value === null ? undefined : Reflect.get(inner.value, key),
            has: (_target, key) => inner.value !== null && key in inner.value,
          },
        ),
      )
      const failure = shallowRef<PlatformUiState | null>(null)
      const downloading = shallowRef(false)
      // The delay is the download's, not this boundary's: one drawn after its download
      // has already run that long, such as the graph the workspace held its stage for,
      // says at once that it is loading instead of leaving the stage blank a second delay.
      let since = 0
      let mounted = true

      function attempt() {
        failure.value = null
        const download = load()
        since = pendingSince
        downloading.value = true
        download.then(
          (loaded) => {
            if (!mounted) return
            view.value = loaded
            downloading.value = false
          },
          (error: unknown) => {
            if (!mounted) return
            console.error(error)
            failure.value = uiError(FAILURE_REASON)
            downloading.value = false
          },
        )
      }

      if (view.value === null) attempt()
      // Made once the first download is under way, so a view drawn after it has already
      // run for the delay says so in its first frame.
      const presence = useLoadingPresence(() => downloading.value, { since: () => since })
      onBeforeUnmount(() => {
        mounted = false
      })

      function panel() {
        if (presence.shown.value) return h(PlatformStatePanel, { state: LOADING, since })
        if (failure.value === null) return null
        return h(PlatformStatePanel, { state: failure.value, onRetry: attempt })
      }

      // Whether the frame held focus as it went, and so took it to the page with it.
      const contentReplaced = useContentReplaced()
      let frameHeldFocus = false
      const frameLeaving = ({ el }: VNode) => {
        frameHeldFocus = el instanceof Node && el.contains(document.activeElement)
      }
      const viewArrived = () => {
        const lost = document.activeElement === null || document.activeElement === document.body
        if (frameHeldFocus && lost) contentReplaced()
        frameHeldFocus = false
      }

      return () => {
        if (view.value !== null && !presence.shown.value)
          return h(view.value, { ...attrs, ref: inner, onVnodeMounted: viewArrived }, slots)
        if (frame === undefined) return panel()
        return h(frame, { ...attrs, onVnodeBeforeUnmount: frameLeaving }, { default: panel })
      }
    },
  })

  return { component: component as unknown as C, ready, load, prefetch, prefetchWhenIdle }
}
