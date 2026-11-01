import { shallowRef } from 'vue'

/** A live host lease; its focus target belongs to the surface it covered. */
export interface OverlayOwnership {
  readonly id: number
  readonly layer: 'drawer' | 'command'
  readonly previousFocus: HTMLElement | null
  /** Closes the host; called with the Escape that asked for it. */
  readonly dismiss: (event: KeyboardEvent) => void
  readonly surface: () => HTMLElement | null
}

type OverlaySession = { focus: HTMLElement | null; overflow: string }

let nextOverlayOwnershipId = 0
const owners = shallowRef<readonly OverlayOwnership[]>([])
let session: OverlaySession | null = null
let restoreScheduled = false
let pendingFocus: HTMLElement | null = null

function activeElement(): HTMLElement | null {
  if (typeof document === 'undefined') return null
  const element = document.activeElement
  return element instanceof HTMLElement && element !== document.body ? element : null
}

function scheduleRestore() {
  if (restoreScheduled) return
  restoreScheduled = true
  queueMicrotask(() => {
    restoreScheduled = false
    const top = owners.value.at(-1)
    const target = pendingFocus
    pendingFocus = null
    if (top) {
      if (target?.isConnected && top.surface()?.contains(target)) target.focus()
      return
    }
    const finished = session
    session = null
    if (typeof document !== 'undefined' && finished) {
      document.body.style.overflow = finished.overflow
      document.removeEventListener('keydown', dismissTop)
    }
    if (finished?.focus?.isConnected) finished.focus.focus()
  })
}

/**
 * Escape belongs to the top overlay wherever the key lands.
 *
 * Each host heard it on its own root, so once the control holding focus was
 * disabled or replaced — a refused answer, a failed refresh — focus fell to the
 * page body, the key never reached the root, and the dialog could no longer be
 * closed from the keyboard. The document hears it now, for whichever host is on
 * top. A popup that consumed the key (a choice list closing) has prevented it,
 * and a key pressed inside another host's surface is not the top one's to take.
 */
function dismissTop(event: KeyboardEvent) {
  if (event.key !== 'Escape' || event.isComposing || event.defaultPrevented) return
  const top = owners.value.at(-1)
  const host = top?.surface()?.closest('.overlay-host')
  const pressedIn = event.target instanceof Element ? event.target.closest('.overlay-host') : null
  if (top && (!pressedIn || pressedIn === host)) top.dismiss(event)
}

/** Keep the page's original focus and scroll state until every live host closes. */
export function claimOverlayOwnership(
  surface: () => HTMLElement | null,
  layer: OverlayOwnership['layer'],
  dismiss: OverlayOwnership['dismiss'],
): OverlayOwnership {
  if (!session) {
    session = {
      focus: activeElement(),
      overflow: typeof document === 'undefined' ? '' : document.body.style.overflow,
    }
    if (typeof document !== 'undefined') document.addEventListener('keydown', dismissTop)
  }
  const lease: OverlayOwnership = {
    dismiss,
    id: ++nextOverlayOwnershipId,
    layer,
    previousFocus: owners.value.length ? activeElement() : session.focus,
    surface,
  }
  const next = [...owners.value]
  const commandIndex = next.findIndex((owner) => owner.layer === 'command')
  if (layer === 'drawer' && commandIndex !== -1) next.splice(commandIndex, 0, lease)
  else next.push(lease)
  owners.value = next
  pendingFocus = null
  if (typeof document !== 'undefined') document.body.style.overflow = 'hidden'
  return lease
}

/** Reactive ownership lets covered hosts suspend their modal semantics and input. */
export function ownsOverlay(lease: OverlayOwnership | null): boolean {
  return lease !== null && owners.value.at(-1)?.id === lease.id
}

/** Remove only this lease; stale releases cannot dismiss or unlock another host. */
export function releaseOverlayOwnership(lease: OverlayOwnership | null): void {
  if (!lease) return
  const index = owners.value.findIndex((owner) => owner.id === lease.id)
  if (index === -1) return
  const wasTop = index === owners.value.length - 1
  owners.value = owners.value.filter((owner) => owner.id !== lease.id)
  if (!wasTop) return
  pendingFocus = lease.previousFocus
  // Keep the session through this microtask so same-tick replacements inherit it.
  scheduleRestore()
}
