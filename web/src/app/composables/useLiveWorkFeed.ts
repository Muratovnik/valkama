import { ref, watch } from 'vue'

import { subscribeLive } from '@/shared/api/planningApi.ts'
import type { PlanningConnectionState } from '@/shared/api/planningApi.ts'
import { useLiveWorkStore } from '@/shared/stores/liveWorkStore.ts'

/** After a frame that did not read closed the stream, how long until it is opened again. */
const RETRY_MS = 10_000

/**
 * The live-work frame for a page with no space stream, so a tab holds one stream.
 *
 * A space's stream carries the frame beside the space, and while one is open this
 * opens nothing. Every other page of the shell — Settings, the portfolio, a route the
 * shell could not open — has none, and `view=live` is opened for it. The decision is
 * the shell's, from what it knows is on show, and waits until it knows: opened while
 * the route was still being read, the stream would close again as a space's opened.
 */
export function useLiveWorkFeed(page: {
  /** The page holds the shell, and the shell knows what it shows. */
  shell: () => boolean
  /** A space's stream is open: its module is on show and has a space. */
  spaceStream: () => boolean
}) {
  const wanted = () => page.shell() && !page.spaceStream()
  const store = useLiveWorkStore()
  const connection = ref<PlanningConnectionState | null>(null)
  const attempt = ref(0)
  let retry: ReturnType<typeof setTimeout> | undefined

  watch(
    [wanted, attempt],
    ([open], _previous, cleanup) => {
      clearTimeout(retry)
      if (!open) {
        connection.value = null
        return
      }
      const close = subscribeLive({
        connection: (state) => {
          connection.value = state
        },
        frame: (frame) => store.accept(frame),
        invalid: (error) => {
          console.error(error)
          retry = setTimeout(() => (attempt.value += 1), RETRY_MS)
        },
      })
      cleanup(() => {
        clearTimeout(retry)
        close()
      })
    },
    { immediate: true, flush: 'post' },
  )

  return { connection }
}
