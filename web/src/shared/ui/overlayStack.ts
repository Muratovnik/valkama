/**
 * The Vue hosts are deliberately small renderers.  This coordinator is the
 * one DOM owner for the cross-overlay concerns that cannot safely live in
 * each renderer independently: body scroll locking and focus restoration.
 *
 * A command can replace a drawer in one Vue update.  The old host may unmount
 * before the new one mounts (or vice versa), so ownership is lease based and
 * stale releases are ignored.  A microtask handoff lets a replacement claim
 * the original trigger without briefly restoring focus to a disappearing
 * control.
 */
export interface OverlayOwnership {
  readonly id: number
  readonly previousFocus: HTMLElement | null
  readonly previousOverflow: string
}

let nextOverlayOwnershipId = 0
let overlayOwner: OverlayOwnership | null = null
let pendingFocus: HTMLElement | null = null
let pendingOverflow: string | null = null
let restoreScheduled = false

function activeElement(): HTMLElement | null {
  if (typeof document === 'undefined') return null
  const element = document.activeElement
  return element instanceof HTMLElement && element !== document.body ? element : null
}

function scheduleRestore() {
  if (restoreScheduled) return
  restoreScheduled = true
  const finish = () => {
    restoreScheduled = false
    if (overlayOwner) return
    const target = pendingFocus
    const overflow = pendingOverflow
    pendingFocus = null
    pendingOverflow = null
    if (typeof document !== 'undefined' && overflow !== null) {
      document.body.style.overflow = overflow
    }
    if (target?.isConnected) target.focus()
  }
  if (typeof queueMicrotask === 'function') queueMicrotask(finish)
  else void Promise.resolve().then(finish)
}

/** Claim the single focus/scroll owner used by every active OverlayHost. */
export function claimOverlayOwnership(): OverlayOwnership {
  const doc = typeof document === 'undefined' ? null : document
  // Preserve an intentional null trigger during a replacement.  Falling back
  // to the currently focused control would capture the old drawer button,
  // which is about to be unmounted by the command surface.
  const previousFocus = overlayOwner
    ? overlayOwner.previousFocus
    : (pendingFocus ?? activeElement())
  const previousOverflow =
    overlayOwner?.previousOverflow ?? pendingOverflow ?? doc?.body.style.overflow ?? ''
  // A replacement keeps the original trigger as the eventual restore target.
  const lease: OverlayOwnership = {
    id: ++nextOverlayOwnershipId,
    previousFocus,
    previousOverflow,
  }
  overlayOwner = lease
  pendingFocus = null
  pendingOverflow = null
  if (doc) doc.body.style.overflow = 'hidden'
  return lease
}

/** Return whether a host still owns the shared DOM responsibilities. */
export function ownsOverlay(lease: OverlayOwnership | null): boolean {
  return lease !== null && overlayOwner?.id === lease.id
}

/** Release a host.  Releasing an already superseded host is a no-op. */
export function releaseOverlayOwnership(lease: OverlayOwnership | null): void {
  if (!lease || !ownsOverlay(lease)) return
  overlayOwner = null
  pendingFocus = lease.previousFocus
  pendingOverflow = lease.previousOverflow
  scheduleRestore()
}
