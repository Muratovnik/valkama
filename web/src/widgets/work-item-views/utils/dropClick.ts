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
 * here keeps the click from anything after it. The caller runs this once the release is over
 * (`afterRelease`), which is when a browser that does send that click has sent it.
 */
export function endDropClickWait() {
  document.addEventListener('click', unheard, { capture: true })
  document.dispatchEvent(new MouseEvent('click'))
  document.removeEventListener('click', unheard, { capture: true })
}

/** A person's next press, by a pointer or a key, which comes before the click it makes. */
const PRESSES = ['pointerdown', 'keydown'] as const

/**
 * Runs `then` once a release is over: at the end of the release's own task, or at the next
 * press if that comes first.
 *
 * A release's click, in a browser that sends one, comes in the same task as the release, so
 * the end of that task is where the release is over. A task queued for then is not sure to
 * run before the next press, though: the browser hears a press ahead of a waiting timer, and
 * after a drop on a busy board the timer came 30–47 ms late, behind an Enter pressed 26 ms
 * after the release, whose click the flag then took. A new press cannot belong to the release
 * that came before it, so it ends the release too, before its own click.
 */
export function afterRelease(then: () => void) {
  let over = false
  const end = () => {
    if (over) return
    over = true
    clearTimeout(timer)
    for (const type of PRESSES) document.removeEventListener(type, end, { capture: true })
    then()
  }
  const timer = setTimeout(end)
  for (const type of PRESSES) document.addEventListener(type, end, { capture: true })
}
