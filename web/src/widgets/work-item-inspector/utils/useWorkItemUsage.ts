import { onBeforeUnmount, ref, shallowRef, watch } from 'vue'

import { fetchItemUsage } from '@/shared/api/planningUsageApi.ts'
import type { ItemUsage, UsageScope } from '@/shared/api/planningUsageApi.ts'

/** The collector moves about once a minute, so a read sooner than that says nothing new. */
const FRESH_MS = 60_000
/** How long a card's head waits for the line it would otherwise be pushed down by. */
const HEAD_WAIT_MS = 800

export interface UsageTarget {
  id: string
  scope: UsageScope
}

/**
 * One usage read of the card: read when the card opens and again when the stream the card
 * already has says something changed, no sooner than the collector can have moved. It never
 * polls: a news arriving too soon is answered once, when the minute is up, and with no news
 * there is no read at all.
 *
 * A failed read takes nothing from the card. It keeps the last answer in place and says only
 * that it failed, since numbers are never what a card waits on past `settled`.
 *
 * A null target asks nothing: the read answers for the primary store, so an attached store's
 * item has no usage to ask for.
 */
export function useWorkItemUsage(target: () => UsageTarget | null, news: () => unknown) {
  const usage = shallowRef<ItemUsage | null>(null)
  const failed = ref(false)
  /** How many answers have come in, for what is read along with this. */
  const version = ref(0)
  let generation = 0
  let lastRead = 0
  let controller: AbortController | undefined
  let late: ReturnType<typeof setTimeout> | undefined
  let current: Promise<void> = Promise.resolve()

  function cancel() {
    generation += 1
    controller?.abort()
    controller = undefined
    clearTimeout(late)
    late = undefined
  }

  async function ask(asked: UsageTarget, signal: AbortSignal, reading: number) {
    try {
      const next = await fetchItemUsage(asked.id, asked.scope, signal)
      if (reading !== generation) return
      usage.value = next
      failed.value = false
      version.value += 1
    } catch {
      if (reading === generation) failed.value = true
    }
  }

  function read() {
    cancel()
    const asked = target()
    if (!asked) {
      current = Promise.resolve()
      return
    }
    lastRead = Date.now()
    controller = new AbortController()
    current = ask(asked, controller.signal, generation)
  }

  /** The first answer to this target, or the end of the head's wait, whichever comes first. */
  async function settled() {
    let timer: ReturnType<typeof setTimeout> | undefined
    const waited = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, HEAD_WAIT_MS)
    })
    await Promise.race([current, waited])
    clearTimeout(timer)
  }

  function refresh() {
    if (!target() || late !== undefined) return
    const wait = lastRead + FRESH_MS - Date.now()
    if (wait <= 0) read()
    else late = setTimeout(read, wait)
  }

  // At once, not after the render: `settled` answers for the target as it stands.
  watch(
    () => JSON.stringify(target()),
    () => {
      usage.value = null
      failed.value = false
      read()
    },
    { flush: 'sync', immediate: true },
  )
  watch(news, refresh)
  onBeforeUnmount(cancel)

  return { failed, read, settled, usage, version }
}
