import { computed, ref, watch } from 'vue'

import { subscribeLive } from '@/shared/api/planningApi.ts'
import type { PlanningConnectionState } from '@/shared/api/planningApi.ts'
import { useLiveWorkStore } from '@/shared/stores/liveWorkStore.ts'

/** After a frame that did not read closed the stream, how long until it is opened again. */
const RETRY_MS = 10_000

/**
 * The live-work frame for a page with no space stream, so a tab holds one stream, and for
 * the shell's first seconds.
 *
 * A space's stream carries the frame beside the space, and while one is open this opens
 * nothing. Every other page of the shell — Settings, the portfolio, a route the shell could
 * not open — has none, and `view=live` is opened for it. The decision is the shell's, from
 * what it knows is on show.
 *
 * The one exception is the start. A space's stream opens only after the space has been read,
 * which on a large space takes seconds, and the list of work going on now would wait for it
 * with the rail's groups under it. So `view=live` opens as the shell starts, before the route
 * is known, and lives only until a space's stream has delivered its own frame to the store,
 * when it closes. When the shell turns out to show a page with no space stream, the same
 * stream goes on as that page's. The start happens once: a space's stream that drops and
 * comes back does not open it again.
 */
export function useLiveWorkFeed(page: {
  /** The shell knows what it shows. */
  known: () => boolean
  /** The page holds the shell: a document page alone has no rail to feed. */
  shell: () => boolean
  /** A space's stream is open: its module is on show and has a space. */
  spaceStream: () => boolean
}) {
  const store = useLiveWorkStore()
  const connection = ref<PlanningConnectionState | null>(null)
  const attempt = ref(0)
  /** The shell turned out to show a page with no space stream, which ends the start too. */
  const settledWithout = ref(false)
  /** The shell is starting, and no space's stream has delivered a frame yet. */
  const starting = () => !settledWithout.value && !store.spaceDelivered
  const withoutSpace = () => page.known() && !page.spaceStream()
  const wanted = computed(() => page.shell() && (starting() || withoutSpace()))
  let retry: ReturnType<typeof setTimeout> | undefined

  // A page with no space stream ends the start: the stream it holds is now that page's.
  watch(
    withoutSpace,
    (settled) => {
      if (settled) settledWithout.value = true
    },
    { immediate: true, flush: 'post' },
  )

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
