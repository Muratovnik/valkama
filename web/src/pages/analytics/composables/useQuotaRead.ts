/**
 * Each account's subscription quota now, as the page's quota tiles and panel read it: one read of
 * `GET /api/analytics/quota` at the browser's own offset, so its times are the reader's clock.
 *
 * Where each window stands now depends on nothing the page chooses — not the filters, the measure
 * or the section. The period reaches only the windows before the current ones that each window's
 * step line draws: the read names its start (`from`), its answer keeps the start it was read
 * over, by which the panel decides what each line holds (`sectionLines`), and it is read again
 * when the page's period changes. It is read when the page opens, again with every refresh the bar asks, and again on the
 * live interval while the page is seen (`useLiveRefresh`), since a window moves whatever period is
 * on show, each time with the period's start as it then stands. While it is read again the
 * answer on show stays; a read again that fails keeps it and says so, and a first read that fails
 * says the quota could not be read. A later read always replaces an earlier one, so a slow answer
 * never draws over a newer one.
 */
import { onScopeDispose, shallowRef, watch } from 'vue'

import { useLiveRefresh } from '@/pages/analytics/composables/useLiveRefresh.ts'

import { fetchQuota } from '@/shared/api/analyticsApi.ts'
import type { Quota } from '@/shared/api/analyticsApi.ts'

/**
 * Where the read stands: its first wait, an answer (`refreshing` while the next is read,
 * `failedAgain` once a read again failed and this one stayed), or a first read that failed.
 */
export type QuotaRead =
  | { status: 'failed' }
  | { status: 'loading' }
  | {
      failedAgain: boolean
      quota: Quota
      refreshing: boolean
      status: 'ready'
      /** The start of the period the answer was read over (`from`); absent, null, for none. */
      from?: string | null
    }

export function useQuotaRead(options: {
  /** The start of the page's period as a time with its offset, or null where it has none. */
  from: () => string | null
}) {
  const read = shallowRef<QuotaRead>({ status: 'loading' })
  let reading: AbortController | null = null

  async function refresh() {
    reading?.abort()
    const controller = new AbortController()
    reading = controller
    const held = read.value
    if (held.status === 'ready') read.value = { ...held, refreshing: true }
    try {
      // `getTimezoneOffset` counts west of UTC as positive; the read counts east.
      const from = options.from()
      const quota = await fetchQuota(-new Date().getTimezoneOffset(), controller.signal, from)
      if (controller.signal.aborted) return
      read.value = { status: 'ready', quota, from, refreshing: false, failedAgain: false }
    } catch {
      if (controller.signal.aborted) return
      read.value =
        held.status === 'ready'
          ? { ...held, refreshing: false, failedAgain: true }
          : { status: 'failed' }
    } finally {
      if (reading === controller) live.restart()
    }
  }

  const live = useLiveRefresh({ live: () => true, refresh: () => void refresh() })
  void refresh()
  // A new period reads its windows before the current ones; the moment alone moving does not.
  watch(options.from, () => void refresh())
  onScopeDispose(() => reading?.abort())

  return { read, refresh }
}
