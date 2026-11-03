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
 */
export function useDrawerWidth(options: {
  /** Enter folds what this edge sizes away and brings it back at the width it had. */
  collapsible?: boolean
  active: () => boolean
  defaultWidth: () => number
  maxWidth: () => number
  minWidth: () => number
  resizable: () => boolean
  storageKey: () => string
}) {
  const preferredDrawerWidth = ref(options.defaultWidth())
  const viewportWidth = ref(typeof window === 'undefined' ? 1440 : window.innerWidth)
  const resizing = ref(false)
  const collapsed = ref(false)
  let resizeStartX = 0
  let resizeStartWidth = options.defaultWidth()

  const drawerMaximum = computed(() =>
    viewportWidth.value <= DRAWER_NARROW_BREAKPOINT
      ? viewportWidth.value
      : Math.min(options.maxWidth(), viewportWidth.value - DRAWER_VIEWPORT_GUTTER),
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
      Math.max(drawerMinimum.value, resizeStartWidth + resizeStartX - event.clientX),
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
      ['ArrowLeft', drawerWidth.value + INSPECTOR_KEYBOARD_STEP],
      ['ArrowRight', drawerWidth.value - INSPECTOR_KEYBOARD_STEP],
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
