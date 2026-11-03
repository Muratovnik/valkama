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

/**
 * A Markdown document read beside or over a card: its own width, kept apart from the
 * card's, so that reading a plan wide does not widen the next card.
 */
export const DOCUMENT_PANE_STORAGE_KEY = 'valkama-document-pane-width'
export const DOCUMENT_PANE_DEFAULT_WIDTH = 720

/** What a dialog stands at however wide the window gets, as its stylesheet also writes it. */
export const DIALOG_WIDTH = 640
/** Beside a card and a document the board keeps a usable column. */
export const BOARD_ROOM_BESIDE_DOCUMENT = 360
/** Nothing under a modal dialog can be used, so beside one only an edge stays. */
export const DIALOG_ROOM_BESIDE_DOCUMENT = 40

/** The widest a document pane can stand beside a surface of this width. */
export function documentPaneRoom(
  surfaceWidth: number,
  roomUnder: number,
  viewportWidth: number,
): number {
  return viewportWidth - surfaceWidth - DRAWER_VIEWPORT_GUTTER - roomUnder
}

/** Whether a document stands beside the surface, which needs at least its minimum there. */
export function documentFitsBeside(
  surfaceWidth: number,
  roomUnder: number,
  viewportWidth: number,
): boolean {
  return documentPaneRoom(surfaceWidth, roomUnder, viewportWidth) >= DRAWER_MIN_WIDTH
}

function drawerMaximumForViewport(viewportWidth: number): number {
  const available = Math.max(0, Math.floor(viewportWidth))
  return available <= DRAWER_NARROW_BREAKPOINT
    ? available
    : Math.min(DRAWER_MAX_WIDTH, available - DRAWER_VIEWPORT_GUTTER)
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
