/**
 * Keeps focus in the viewer when what held it goes. A new state takes controls and text
 * away under the reader — Refresh to a refusal or a deleted file, Back to a document with
 * nothing behind it, a new text in place of the old — and the browser then drops focus on
 * the page itself. Escape pressed there is the window's and not the viewer's: it asked to
 * close the card behind a document still open.
 *
 * It acts only on focus the viewer had and lost to nothing. A read the window's return
 * started never takes focus from where the reader went meanwhile.
 */
import { onBeforeUnmount, onMounted } from 'vue'
import type { Ref } from 'vue'

export function useFocusKeeper(root: Ref<HTMLElement | null>, landing: () => void) {
  let held: Element | null = null
  const note = ({ target }: FocusEvent) => {
    held = target instanceof Element ? target : null
  }
  // Focus that left a control still there went where the reader sent it, not to nothing.
  const leave = ({ target }: FocusEvent) => {
    queueMicrotask(() => {
      if (held === target && held?.isConnected) held = null
    })
  }
  const lostToNothing = () => {
    const active = document.activeElement
    return held !== null && !held.isConnected && (active === null || active === document.body)
  }
  const watcher = new MutationObserver(() => {
    if (!lostToNothing()) return
    held = null
    landing()
  })
  onMounted(() => {
    const viewer = root.value
    if (!viewer) return
    viewer.addEventListener('focusin', note)
    viewer.addEventListener('focusout', leave)
    watcher.observe(viewer, { childList: true, subtree: true })
  })
  onBeforeUnmount(() => {
    watcher.disconnect()
    root.value?.removeEventListener('focusin', note)
    root.value?.removeEventListener('focusout', leave)
  })
}
