import { computed, ref } from 'vue'

import { useEventListener } from '@vueuse/core'

import {
  DRAWER_NARROW_BREAKPOINT,
  DRAWER_VIEWPORT_GUTTER,
  INSPECTOR_KEYBOARD_STEP,
} from '@/shared/lib/shellLayout.ts'

/**
 * How wide a drawer stands: what the reader asked for by its grip or its keys, held
 * to what the window has room for, and kept for the next open.
 *
 * The edge is at the start of what it sizes for a drawer or a pane, which grows as the
 * edge moves left; the rail is sized by its end, and grows as the edge moves right. The
 * arrow keys follow the edge: the one that moves it outward widens.
 */
export function useDrawerWidth(options: {
  /** Enter folds what this edge sizes away and brings it back at the width it had. */
  collapsible?: boolean
  /** Which edge of what it sizes the grip stands on; the start unless said. */
  edge?: 'start' | 'end'
  active: () => boolean
  defaultWidth: () => number
  /** The widest it may stand, given how wide the window is. */
  maxWidth: (viewportWidth: number) => number
  minWidth: () => number
  resizable: () => boolean
  storageKey: () => string
}) {
  const preferredDrawerWidth = ref(options.defaultWidth())
  const viewportWidth = ref(typeof window === 'undefined' ? 1440 : window.innerWidth)
  const resizing = ref(false)
  const collapsed = ref(false)
  /** +1 when moving the edge right widens, -1 when moving it left does. */
  const outward = options.edge === 'end' ? 1 : -1
  let resizeStartX = 0
  let resizeStartWidth = options.defaultWidth()

  const drawerMaximum = computed(() =>
    viewportWidth.value <= DRAWER_NARROW_BREAKPOINT
      ? viewportWidth.value
      : Math.min(
          options.maxWidth(viewportWidth.value),
          viewportWidth.value - DRAWER_VIEWPORT_GUTTER,
        ),
  )
  const drawerMinimum = computed(() => Math.min(options.minWidth(), drawerMaximum.value))
  const drawerWidth = computed(() =>
    Math.min(
      drawerMaximum.value,
      Math.max(drawerMinimum.value, Math.round(preferredDrawerWidth.value)),
    ),
  )

  function measureViewport() {
    viewportWidth.value = window.innerWidth
  }

  function restoreDrawerWidth() {
    if (!options.resizable() || typeof localStorage === 'undefined') return
    const stored = Number(localStorage.getItem(options.storageKey()))
    const requested = Number.isFinite(stored) && stored > 0 ? stored : options.defaultWidth()
    preferredDrawerWidth.value = Math.round(requested)
  }

  function storeDrawerWidth() {
    if (!options.resizable() || typeof localStorage === 'undefined') return
    localStorage.setItem(options.storageKey(), String(preferredDrawerWidth.value))
  }

  function beginResize(event: PointerEvent) {
    if (!options.active() || !options.resizable() || event.button !== 0) return
    event.preventDefault()
    collapsed.value = false
    resizeStartX = event.clientX
    resizeStartWidth = drawerWidth.value
    resizing.value = true
  }

  function resizeFromPointer(event: PointerEvent) {
    preferredDrawerWidth.value = Math.min(
      drawerMaximum.value,
      Math.max(drawerMinimum.value, resizeStartWidth + outward * (event.clientX - resizeStartX)),
    )
  }

  function endResize() {
    resizing.value = false
    storeDrawerWidth()
  }

  useEventListener(window, 'resize', measureViewport)
  useEventListener(window, 'pointermove', (event: PointerEvent) => {
    if (resizing.value) resizeFromPointer(event)
  })
  useEventListener(window, 'pointerup', () => {
    if (resizing.value) endResize()
  })

  function resizeFromKeyboard(event: KeyboardEvent) {
    if (event.key === 'Enter' && options.collapsible && options.active()) {
      event.preventDefault()
      collapsed.value = !collapsed.value
      return
    }
    const requested = new Map([
      ['Home', drawerMinimum.value],
      ['End', drawerMaximum.value],
      ['ArrowLeft', drawerWidth.value - outward * INSPECTOR_KEYBOARD_STEP],
      ['ArrowRight', drawerWidth.value + outward * INSPECTOR_KEYBOARD_STEP],
    ])
    const target = requested.get(event.key)
    if (!options.active() || target === undefined) return
    event.preventDefault()
    collapsed.value = false
    preferredDrawerWidth.value = Math.min(
      drawerMaximum.value,
      Math.max(drawerMinimum.value, target),
    )
    storeDrawerWidth()
  }

  return {
    beginResize,
    collapsed,
    drawerMaximum,
    drawerMinimum,
    drawerWidth,
    measureViewport,
    resizeFromKeyboard,
    resizing,
    restoreDrawerWidth,
    viewportWidth,
  }
}
