/**
 * When a wait is shown: the one rule every loading mark in the product follows.
 *
 * A wait that ends quickly shows nothing, and a wait that is shown stays long enough
 * to be read. Both halves are the same defect seen from two sides: a loading block that
 * lives for a few dozen milliseconds is a flash, whether it flashed because it came at
 * once or because it went at once. A switch of space on a two-megabyte board reads in
 * about 170–200 ms between the moment the space is cleared and the moment the next one
 * is drawn, so a delay of 200 ms let a slightly slower read through as a sliver of
 * «Loading»; the delay is set past that with room to spare, and the minimum keeps a
 * read that only just outlasts it from flashing in its turn.
 *
 * `PlatformStatePanel` follows it for every state it is handed, and `lazyView` for
 * every download, so a screen that shows a wait through either cannot get it wrong. A
 * screen whose own branch takes the panel away has to keep the branch while `held`, and
 * a wait said in a line of its own — a section of a card, a dialog's note, a search —
 * takes `shown` and `held` from here too, and says the panel's word,
 * `platform.states.loading`.
 *
 * A screen reader hears what the eye sees: a wait is announced once, when it is shown, by
 * writing its word into a status region that has stood empty since the wait began. A
 * region drawn together with its words is not reliably announced, and one that held its
 * words from the first frame told a reader about a read that answered before anyone saw
 * it.
 */
import { computed, onScopeDispose, shallowRef, watch } from 'vue'

/** How long a wait runs before anything says it is waiting. */
export const LOADING_DELAY_MS = 300

/** How long a wait, once shown, stays shown, however soon what it waited for arrives. */
export const LOADING_MIN_SHOWN_MS = 400

/** When a wait began, and how long it runs before it is said, where those are not the rule's. */
interface LoadingPresenceOptions {
  /**
   * The delay before the wait is said, read as each wait begins; `LOADING_DELAY_MS` when
   * absent. Only background work over something already drawn waits longer, as the
   * graph's re-layout does. The minimum once shown is the same for every wait.
   */
  delay?: () => number
  /**
   * When the wait began (`Date.now()`), for a wait that began before whatever shows it was
   * drawn: the delay is the wait's, not the mark's, so a mark drawn late does not add a
   * second delay.
   */
  since?: () => number | undefined
}

/**
 * Follow one wait.
 *
 * `waiting` says whether it is still under way.
 *
 * `shown` is whether the mark is on screen. `held` is whether what the wait stands in
 * for must still stay away: while waiting, and for the rest of the minimum after it.
 */
export function useLoadingPresence(
  waiting: () => boolean,
  { since, delay }: LoadingPresenceOptions = {},
) {
  const shown = shallowRef(false)
  let shownAt = 0
  let timer: ReturnType<typeof setTimeout> | undefined

  function show() {
    timer = undefined
    shown.value = true
    shownAt = Date.now()
  }

  function hide() {
    timer = undefined
    shown.value = false
  }

  watch(
    waiting,
    (now) => {
      clearTimeout(timer)
      timer = undefined
      if (now) {
        // Waiting again before the minimum ran out: the mark simply stays.
        if (shown.value) return
        const waited = Date.now() - (since?.() ?? Date.now())
        const before = delay?.() ?? LOADING_DELAY_MS
        if (waited >= before) show()
        else timer = setTimeout(show, before - waited)
        return
      }
      if (!shown.value) return
      const left = LOADING_MIN_SHOWN_MS - (Date.now() - shownAt)
      if (left <= 0) hide()
      else timer = setTimeout(hide, left)
    },
    // Before the owner draws, not as each value is written: a change of props writes them
    // one at a time, and a wait that began read the time it began from the old value.
    { immediate: true },
  )
  onScopeDispose(() => clearTimeout(timer))

  return {
    shown: computed(() => shown.value),
    held: computed(() => waiting() || shown.value),
  }
}
