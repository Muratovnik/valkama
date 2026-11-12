/**
 * A live period reads itself again on a fixed interval, and only while a person can see the page.
 *
 * The interval runs from the last read of the view, whatever asked it: this, the bar's refresh or
 * a new period or filter (`restart`). While the document is hidden no timer runs, so a page left in
 * a background tab asks nothing at all; when it is shown again it reads at once if an interval was
 * missed meanwhile, and otherwise waits out the rest of the one running. A period that is not live
 * never reads itself again.
 */
import { onScopeDispose, watch } from 'vue'

import { useDocumentVisibility } from '@vueuse/core'

/** How often the live period reads itself again, in ms. */
export const LIVE_INTERVAL = 30_000

export function useLiveRefresh(options: {
  /** Whether the period on show is live. */
  live: () => boolean
  /** Reads the view again, as of a new moment. */
  refresh: () => void
}) {
  const visibility = useDocumentVisibility()
  let timer: ReturnType<typeof setTimeout> | undefined
  /** When the next read is due, in ms since the epoch. */
  let due = 0

  const stop = () => {
    clearTimeout(timer)
    timer = undefined
  }

  const running = () => options.live() && visibility.value === 'visible'

  /** Waits for the next read, if the period is live and the page is seen. */
  function schedule() {
    stop()
    if (running()) timer = setTimeout(tick, Math.max(0, due - Date.now()))
  }

  /** The view was just read: the next read is an interval from now. */
  function restart() {
    due = Date.now() + LIVE_INTERVAL
    schedule()
  }

  function tick() {
    timer = undefined
    if (!running()) return
    options.refresh()
    restart()
  }

  watch(options.live, (live) => (live ? restart() : stop()), { immediate: true })
  watch(visibility, (shown) => {
    if (shown !== 'visible') stop()
    else if (Date.now() >= due) tick()
    else schedule()
  })
  onScopeDispose(stop)

  return { restart }
}
