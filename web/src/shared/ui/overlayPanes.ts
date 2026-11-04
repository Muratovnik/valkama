/** What two panes of one overlay surface share: their names, their room, the key between them. */
import { computed, ref, watch } from 'vue'
import type { Ref, WatchSource } from 'vue'

import { DIALOG_WIDTH, documentFitsBeside, documentPaneRoom } from '@/shared/lib/shellLayout.ts'

/** The panes of a surface, each named for a screen reader, and the edge between them. */
export interface OverlayPaneNames {
  /** What the pane's edge says of it while it is folded away. */
  folded: string
  /** The name of the pane beside what the surface holds. */
  label: string
  /** The name of what the surface holds, as one of the two. */
  main: string
  /** The name of the edge that sizes the pane. */
  resize: string
}

/** What a surface says of itself to whoever would put a pane in it. */
export interface PaneFit {
  /** It is the surface on top, so a press came from it. */
  active: boolean
  fits: boolean
}

/**
 * Whether a pane fits beside the surface and how wide it may stand. While the surface's edge
 * is being dragged both keep to the width before the drag, or a pane would jump between
 * hosts under the pointer; the window's own width counts at once.
 */
export function usePaneFit(options: {
  isDialog: () => boolean
  moving: () => boolean
  room: () => number | undefined
  viewportWidth: () => number
  width: () => number
}) {
  const settled = ref(options.width())
  watch([options.width, options.moving], ([width, moving]) => {
    if (!moving) settled.value = width
  })
  const standing = computed(() => (options.isDialog() ? DIALOG_WIDTH : settled.value))
  const paneFits = computed(() => {
    const room = options.room()
    return room !== undefined && documentFitsBeside(standing.value, room, options.viewportWidth())
  })
  const paneWidest = computed(() =>
    documentPaneRoom(standing.value, options.room() ?? 0, options.viewportWidth()),
  )
  return { paneFits, paneWidest }
}

/**
 * What a surface does as a pane comes or goes: it moves over by the room that took, the two
 * as one object, by a transform so that nothing in them is laid out again. It stood where it
 * ended at once, so a card jumped from under a reader who had just pressed a link in it.
 * Under reduced motion it still does, since a script's animation is not the stylesheet's.
 */
export function useSurfaceGlide(surface: Ref<HTMLElement | null>, change: WatchSource<boolean>) {
  let leftBefore = 0
  watch(change, () => {
    leftBefore = surface.value?.getBoundingClientRect().left ?? 0
  })
  watch(
    change,
    () => {
      const moving = surface.value
      if (!moving?.animate || matchMedia('(prefers-reduced-motion: reduce)').matches) return
      const style = getComputedStyle(moving)
      const across = leftBefore - moving.getBoundingClientRect().left
      if (across !== 0)
        moving.animate([{ transform: `translateX(${across}px)` }, { transform: 'none' }], {
          duration: Number.parseFloat(style.getPropertyValue('--duration-surface')) * 1000,
          easing: style.getPropertyValue('--ease-out'),
        })
    },
    { flush: 'post' },
  )
}

/** A pane folded away is inert, so focus sent there stays where it was. */
const reachable = (element: HTMLElement | undefined | null): element is HTMLElement =>
  Boolean(element?.isConnected) && Boolean(element?.checkVisibility({ visibilityProperty: true }))

/**
 * F6 and Shift+F6 go to the other pane, to where focus last was in it, else to its title,
 * or to what it is read with where it has no title that takes focus. Where it was may have
 * been scrolled away since, and the reader's place outranks it, so this does not scroll.
 * With one pane there is nowhere to go, and the key is the browser's.
 */
export function usePaneWalk(surface: () => HTMLElement | null) {
  const lastFocus = new WeakMap<Element, HTMLElement>()

  const panes = () => [...(surface()?.querySelectorAll<HTMLElement>('[data-overlay-pane]') ?? [])]

  function notePaneFocus({ target }: FocusEvent) {
    if (!(target instanceof HTMLElement)) return
    const pane = target.closest('[data-overlay-pane]')
    if (pane) lastFocus.set(pane, target)
  }

  function walkPanes(event: KeyboardEvent) {
    const all = panes()
    if (all.length < 2) return
    event.preventDefault()
    const from = document.activeElement?.closest('[data-overlay-pane]')
    const next = all.find((pane) => pane !== from && reachable(pane))
    if (!next) return
    const remembered = lastFocus.get(next)
    const landing = reachable(remembered)
      ? remembered
      : (next.querySelector<HTMLElement>('[data-pane-title]') ??
        next.querySelector<HTMLElement>('[data-overlay-scroller]') ??
        next)
    landing.focus({ preventScroll: true })
  }

  return { notePaneFocus, walkPanes }
}
