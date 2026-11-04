/**
 * Whether a press on a link to a place in this app is the page's to answer, or the
 * browser's.
 *
 * A plain press with the primary button opens in place, through whoever owns the link,
 * so a draft is asked about and Back returns; this is the test `RouterLink` makes before it
 * takes a click. A press with a modifier or the middle button is the browser's in a
 * browser: a new tab or window, or a download, as for any link.
 *
 * The desktop app is not a browser with tabs. A card's address handed to its window policy
 * goes to the system browser, which would start the desktop app again and leave a tab
 * behind saying so, and Alt would save the page as a file. So there every press opens in
 * place; a document has its own button for a window of its own.
 */
const modified = (event: MouseEvent) =>
  event.ctrlKey || event.metaKey || event.shiftKey || event.altKey

/** True when the page opens the link itself and the browser's own answer is to be prevented. */
export function opensInPlace(event: MouseEvent): boolean {
  if (event.defaultPrevented || event.button > 1) return false
  if (event.button === 0 && !modified(event)) return true
  return window.valkamaDesktop !== undefined
}
