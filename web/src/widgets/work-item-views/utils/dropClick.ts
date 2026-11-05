const unheard = (event: Event) => event.stopImmediatePropagation()

/**
 * Ends the drop library's wait for the click a release ends with.
 *
 * In a drag drawn by the page rather than the platform, the library sets a flag at the start
 * to swallow that click, and only a click or a reading of another stack clears it. A release
 * can end with no click at all: the browser sends none once the element the press went down
 * on has been moved, and this board moves it back as it reads every drop. The flag then stood
 * until the person's next click, on any tile, and took that.
 *
 * The flag is the library's own and it offers no way to clear it, so this hands it the one
 * thing it waits for. Its listener on the document is the first to hear; the listener added
 * here keeps the click from anything after it. The caller runs this once the release's own
 * task is over, which is when a browser that does send that click has sent it.
 */
export function endDropClickWait() {
  document.addEventListener('click', unheard, { capture: true })
  document.dispatchEvent(new MouseEvent('click'))
  document.removeEventListener('click', unheard, { capture: true })
}
