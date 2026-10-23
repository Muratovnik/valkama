import { shallowRef } from 'vue'

/** A live host lease; its focus target belongs to the surface it covered. */
export interface OverlayOwnership {
  readonly id: number
  readonly layer: 'drawer' | 'command'
  readonly previousFocus: HTMLElement | null
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
    if (typeof document !== 'undefined' && finished)
      document.body.style.overflow = finished.overflow
    if (finished?.focus?.isConnected) finished.focus.focus()
  })
}

/** Keep the page's original focus and scroll state until every live host closes. */
export function claimOverlayOwnership(
  surface: () => HTMLElement | null,
  layer: OverlayOwnership['layer'],
): OverlayOwnership {
  if (!session) {
    session = {
      focus: activeElement(),
      overflow: typeof document === 'undefined' ? '' : document.body.style.overflow,
    }
  }
  const lease: OverlayOwnership = {
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
