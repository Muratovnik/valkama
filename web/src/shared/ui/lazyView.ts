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
 *   as hovering the control that will open it, so the switch itself is instant.
 *
 * The holder is module-level on purpose: the code is downloaded once per page,
 * so whether it is resident is one fact shared by every place that draws it.
 */
import { defineComponent, h, onBeforeUnmount, shallowRef } from 'vue'
import type { Component, ShallowRef } from 'vue'

import { uiError, uiLoading } from '@/shared/api/platformUiState.ts'
import type { PlatformUiState } from '@/shared/api/platformUiState.ts'
import { useLoadingPresence } from '@/shared/ui/loadingPresence.ts'
import PlatformStatePanel from '@/shared/ui/PlatformStatePanel.vue'

const LOADING = uiLoading()
const FAILURE_REASON = 'platform.failures.viewDownloadFailed'

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
}

/** Wrap a dynamic import as a view that loads on demand. */
export function lazyView<C extends Component>(loader: () => Promise<{ default: C }>): LazyView<C> {
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

  const component = defineComponent({
    name: 'LazyView',
    inheritAttrs: false,
    setup(_props, { attrs, slots }) {
      const view = shallowRef<Component | null>(resident)
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
      const presence = useLoadingPresence(
        () => downloading.value,
        () => since,
      )
      onBeforeUnmount(() => {
        mounted = false
      })

      return () => {
        if (presence.shown.value) return h(PlatformStatePanel, { state: LOADING, since })
        if (view.value !== null) return h(view.value, attrs, slots)
        if (failure.value === null) return null
        return h(PlatformStatePanel, { state: failure.value, onRetry: attempt })
      }
    },
  })

  return { component: component as unknown as C, ready, load, prefetch }
}
