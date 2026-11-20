/**
 * Each account's subscription quota now, as the page's quota tiles and panel read it: one read of
 * `GET /api/analytics/quota` at the browser's own offset, so its times are the reader's clock.
 *
 * It depends on nothing the page chooses — not the period, the filters, the measure or the
 * section — because the quota is where each window stands now. It is read when the page opens,
 * again with every refresh the bar asks, and again on the live interval while the page is seen
 * (`useLiveRefresh`), since a window moves whatever period is on show. While it is read again the
 * answer on show stays; a read again that fails keeps it and says so, and a first read that fails
 * says the quota could not be read. A later read always replaces an earlier one, so a slow answer
 * never draws over a newer one.
 */
import { onScopeDispose, shallowRef } from 'vue'

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
  | { failedAgain: boolean; quota: Quota; refreshing: boolean; status: 'ready' }

export function useQuotaRead() {
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
      const quota = await fetchQuota(-new Date().getTimezoneOffset(), controller.signal)
      if (controller.signal.aborted) return
      read.value = { status: 'ready', quota, refreshing: false, failedAgain: false }
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
  onScopeDispose(() => reading?.abort())

  return { read, refresh }
}
