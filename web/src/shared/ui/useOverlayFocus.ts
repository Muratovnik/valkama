import { nextTick } from 'vue'

import { pageWasTouched } from '@/shared/ui/overlayStack.ts'

/** Where focus goes in an overlay surface: on an open, and when a Tab runs out of controls. */
export function useOverlayFocus(options: {
  active: () => boolean
  isDrawer: () => boolean
  surface: () => HTMLElement | null
}) {
  function focusable(): HTMLElement[] {
    const surface = options.surface()
    return surface
      ? Array.from(
          surface.querySelectorAll<HTMLElement>(
            'button:not([disabled]), a[href], summary, input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
          ),
        ).filter(
          (item) =>
            !item.closest('[inert], [aria-hidden="true"]') &&
            item.checkVisibility({ visibilityProperty: true }),
        )
      : []
  }

  /** The first thing to act on: the grip that resizes a drawer is not what it was opened for. */
  function firstControl() {
    return focusable().find((control) => control.dataset.overlayResizer === undefined)
  }

  /** Where focus waits on an open nobody asked for, until a Tab or a press takes it on. */
  let waitingOn: HTMLElement | null = null

  /**
   * A drawer can open on nobody's input: an address, a link from outside, a reload. A
   * browser rings focus it cannot put down to a pointer, so its first control stood there
   * ringed as if the reader had tabbed to it, on every such open. Focus waits instead on
   * what the drawer is read with, which has no ring, answers the keys that scroll, and
   * stands inside a dialog a screen reader names. A Tab goes on to the first control from
   * there. After any input the first control takes it, and the browser decides from that
   * input whether it rings, which is what shows a keyboard reader where it is.
   */
  async function focusSurface() {
    await nextTick()
    const surface = options.surface()
    if (!options.active() || surface?.contains(document.activeElement)) return
    if (options.isDrawer() && !pageWasTouched()) {
      waitingOn = surface?.querySelector<HTMLElement>('[data-overlay-scroller]') ?? surface ?? null
      waitingOn?.focus()
      return
    }
    ;(firstControl() ?? surface)?.focus()
  }

  const roundToFirst = () => (focusable()[0] ?? options.surface())?.focus()
  const roundToLast = () => (focusable().at(-1) ?? options.surface())?.focus()

  /**
   * A Tab is the browser's to move, from where the reader is, and the trap holds only the
   * ends: a stop either side of the surface sends focus round to the far end. The browser
   * goes on from a press too, from the very place pressed, but focus outranks that place, and
   * a press on text gives focus to the nearest ancestor that holds it: the scroller, or the
   * surface itself in the bar. Every Tab then started from the head of that ancestor, the
   * first fact or the far end of the card. Let go, focus goes on from the press.
   */
  function trapFocus(event: KeyboardEvent) {
    if (event.key !== 'Tab' || event.defaultPrevented || !options.active()) return
    const focused = document.activeElement
    if (focused === waitingOn) {
      event.preventDefault()
      waitingOn = null
      if (event.shiftKey) roundToLast()
      else (firstControl() ?? focusable()[0] ?? options.surface())?.focus()
    } else if (focused instanceof HTMLElement && focused.tabIndex < 0) {
      focused.blur()
    }
  }

  function stopWaiting() {
    waitingOn = null
  }

  return { focusSurface, roundToFirst, roundToLast, stopWaiting, trapFocus }
}
