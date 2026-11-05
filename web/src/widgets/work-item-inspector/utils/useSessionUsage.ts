import { onBeforeUnmount, shallowRef, watch } from 'vue'

import { fetchSessionUsage } from '@/shared/api/planningUsageApi.ts'
import type { SessionUsage } from '@/shared/api/planningUsageApi.ts'

/** A browser keeps few connections per host, and the card's stream holds one of them. */
const AT_ONCE = 3

/**
 * What each session on the tab took as a whole, read while the tab is open: when it opens and
 * again each time the card's own numbers have been read, so this needs no news of its own. A
 * session whose read fails simply has no total, and an answer stays until the next replaces it.
 */
export function useSessionUsage(sessions: () => readonly string[], version: () => number) {
  const answers = shallowRef<ReadonlyMap<string, SessionUsage>>(new Map())
  const waiting = shallowRef<ReadonlySet<string>>(new Set())
  let controller: AbortController | undefined

  async function readEach(queue: string[], signal: AbortSignal) {
    for (let session = queue.shift(); session !== undefined; session = queue.shift()) {
      try {
        const answer = await fetchSessionUsage(session, signal)
        if (signal.aborted) return
        answers.value = new Map(answers.value).set(session, answer)
      } catch {
        // No total for this session; the rows of its agents stand without one.
      }
      if (signal.aborted) return
      const left = new Set(waiting.value)
      left.delete(session)
      waiting.value = left
    }
  }

  function readAll() {
    controller?.abort()
    const reading = new AbortController()
    controller = reading
    const queue = [...sessions()]
    waiting.value = new Set(queue.filter((session) => !answers.value.has(session)))
    for (let worker = 0; worker < AT_ONCE; worker += 1) void readEach(queue, reading.signal)
  }

  watch(() => `${sessions().join(',')}|${version()}`, readAll, { immediate: true })
  onBeforeUnmount(() => controller?.abort())

  return { answers, waiting }
}
