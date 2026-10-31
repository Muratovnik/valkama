/**
 * Whether the page may move on from what it shows now.
 *
 * Unsaved work lives deep in a widget, and the navigations that would drop it
 * start far above it: the browser's Back and Forward, global search, any route the shell writes.
 * The router cannot reach into the widget and the widget may not import the
 * router, so they meet here. A surface holding a draft registers a check while
 * it is on screen; the router asks every check before it moves, and a check
 * answers by asking the operator in its own place.
 */
type LeaveCheck = () => boolean | Promise<boolean>

const checks = new Set<LeaveCheck>()

/** Register a check for as long as the surface is mounted; the result removes it. */
export function registerLeaveCheck(check: LeaveCheck): () => void {
  checks.add(check)
  return () => {
    checks.delete(check)
  }
}

/** True when every registered surface agrees to be left. */
export async function mayLeave(): Promise<boolean> {
  for (const check of checks) if (!(await check())) return false
  return true
}
