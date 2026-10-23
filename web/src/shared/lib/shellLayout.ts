export const SESSION_INSPECTOR_STORAGE_KEY = 'valkama-session-inspector-width'
// The value keeps its old spelling on purpose: it is a key in the operator's
// browser storage, and renaming it would throw away the width they set.
export const INSPECTOR_DRAWER_STORAGE_KEY = 'valkama-card-drawer-width'

export const INSPECTOR_MIN_WIDTH = 360
export const INSPECTOR_MAX_WIDTH = 720
export const INSPECTOR_KEYBOARD_STEP = 16

export const DRAWER_MIN_WIDTH = 440
export const DRAWER_DEFAULT_WIDTH = 650
export const DRAWER_MAX_WIDTH = 960
export const DRAWER_VIEWPORT_GUTTER = 40
export const DRAWER_NARROW_BREAKPOINT = 620

function drawerMaximumForViewport(viewportWidth: number): number {
  const available = Math.max(0, Math.floor(viewportWidth))
  if (available <= DRAWER_NARROW_BREAKPOINT) return available
  return Math.min(DRAWER_MAX_WIDTH, available - DRAWER_VIEWPORT_GUTTER)
}

export function clampDrawerWidth(width: number, viewportWidth: number): number {
  const maximum = drawerMaximumForViewport(viewportWidth)
  const minimum = Math.min(DRAWER_MIN_WIDTH, maximum)
  return Math.min(maximum, Math.max(minimum, Math.round(width)))
}

export function drawerWidthFromPointer(
  startWidth: number,
  startX: number,
  currentX: number,
  viewportWidth: number,
): number {
  return clampDrawerWidth(startWidth + startX - currentX, viewportWidth)
}

export function drawerWidthFromKey(
  currentWidth: number,
  key: string,
  viewportWidth: number,
): number {
  if (key === 'Home') return clampDrawerWidth(DRAWER_MIN_WIDTH, viewportWidth)
  if (key === 'End') return clampDrawerWidth(DRAWER_MAX_WIDTH, viewportWidth)
  if (key === 'ArrowLeft')
    return clampDrawerWidth(currentWidth + INSPECTOR_KEYBOARD_STEP, viewportWidth)
  if (key === 'ArrowRight')
    return clampDrawerWidth(currentWidth - INSPECTOR_KEYBOARD_STEP, viewportWidth)
  return currentWidth
}
