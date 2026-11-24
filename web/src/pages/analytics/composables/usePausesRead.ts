/**
 * The pauses before model requests over the page's period, as the pauses section reads them: one
 * read of `GET /api/analytics/pauses` at the browser's own offset.
 *
 * The read goes back to the transcripts, which takes seconds over a long period, so it is asked
 * only while the section is on show — its panel owns it: when the panel opens, when the period
 * changes, and on the bar's refresh (`refresh`). Nothing else reaches it: not the filters, the
 * measure or the live interval. While it is read again the answer on show stays; a read again
 * that fails keeps it and says so, and a first read that fails says the pauses could not be read.
 * A later read always replaces an earlier one, so a slow answer never draws over a newer one.
 */
import { onScopeDispose, shallowRef, watch } from 'vue'

import { periodBounds } from '@/pages/analytics/utils/analyticsPeriod.ts'

import type { AnalyticsView } from '@/shared/api/analyticsAddress.ts'
import { fetchPauses } from '@/shared/api/analyticsPausesApi.ts'
import type { Pauses, PausesReading } from '@/shared/api/analyticsPausesApi.ts'

/**
 * Where the read stands: not asked yet or its first wait (`progress`, how far the server got once
 * it says it is still reading), an answer (`readAt`, the moment it came,
 * `refreshing` while the next is read, `failedAgain` once a read again failed and this one stayed),
 * a first read that failed, or a period the view names none of.
 */
export type PausesRead =
  | { status: 'failed' }
  | { status: 'loading'; progress?: PausesReading }
  | { status: 'no-period' }
  | { failedAgain: boolean; pauses: Pauses; readAt: string; refreshing: boolean; status: 'ready' }

export function usePausesRead(options: { view: () => AnalyticsView }) {
  const read = shallowRef<PausesRead>({ status: 'loading' })
  let reading: AbortController | null = null

  async function refresh() {
    reading?.abort()
    const bounds = periodBounds(options.view(), new Date())
    if (!bounds) {
      read.value = { status: 'no-period' }
      return
    }
    const controller = new AbortController()
    reading = controller
    const held = read.value
    read.value = held.status === 'ready' ? { ...held, refreshing: true } : { status: 'loading' }
    try {
      const pauses = await fetchPauses(bounds, controller.signal, (progress) => {
        if (!controller.signal.aborted && read.value.status === 'loading')
          read.value = { status: 'loading', progress }
      })
      if (controller.signal.aborted) return
      read.value = {
        status: 'ready',
        pauses,
        readAt: new Date().toISOString(),
        refreshing: false,
        failedAgain: false,
      }
    } catch {
      if (controller.signal.aborted) return
      read.value =
        held.status === 'ready'
          ? { ...held, refreshing: false, failedAgain: true }
          : { status: 'failed' }
    }
  }

  /** What names the period: a preset, or its own ends. The moment moving changes nothing. */
  const period = () => {
    const { period: preset, from, to } = options.view()
    return `${preset}|${from}|${to}`
  }
  watch(period, () => void refresh(), { immediate: true })
  onScopeDispose(() => reading?.abort())

  return { read, refresh }
}
