/**
 * The pauses before model requests over the page's period, as the pauses section reads them: one
 * read of `GET /api/analytics/pauses` at the browser's own offset, narrowed to the page's scope
 * (`UsageScope`) as its other reads are: the runs on the work its space's board holds, those of
 * its project in a project scope, and every run on the global page.
 *
 * The read goes back to the transcripts, which takes seconds over a long period, so it is asked
 * only while the section is on show — its panel owns it: when the panel opens, when the period,
 * the space or the project changes, and on the bar's refresh (`refresh`). Nothing else reaches
 * it: not the filters, the measure or the live interval. While it is read again the answer on show stays; a read again
 * that fails keeps it and says so, and a first read that fails says the pauses could not be read.
 * A later read always replaces an earlier one, so a slow answer never draws over a newer one.
 */
import { onScopeDispose, shallowRef, watch } from 'vue'

import type { UsageScope } from '@/pages/analytics/composables/useSharedUsage.ts'
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

export function usePausesRead(options: { scope: () => UsageScope; view: () => AnalyticsView }) {
  const read = shallowRef<PausesRead>({ status: 'loading' })
  /**
   * Whether a read of another scope or period is under way while the answer on show stays drawn:
   * the section dims it then (`useAnewDimmed`), as the other sections dim a new view. A refresh of
   * the same key dims nothing.
   */
  const anew = shallowRef(false)
  let reading: AbortController | null = null
  /** What names the answer on show, so a failed read keeps it only for the same scope and period. */
  let shownFor: string | null = null

  async function refresh() {
    reading?.abort()
    const bounds = periodBounds(options.view(), new Date())
    if (!bounds) {
      read.value = { status: 'no-period' }
      shownFor = null
      anew.value = false
      return
    }
    const controller = new AbortController()
    reading = controller
    const key = period()
    const held = read.value
    anew.value = held.status === 'ready' && shownFor !== key
    read.value = held.status === 'ready' ? { ...held, refreshing: true } : { status: 'loading' }
    try {
      const { space, projectId } = options.scope()
      const query = { ...bounds, project: projectId, space }
      const pauses = await fetchPauses(query, controller.signal, (progress) => {
        if (!controller.signal.aborted && read.value.status === 'loading')
          read.value = { status: 'loading', progress }
      })
      if (controller.signal.aborted) return
      anew.value = false
      read.value = {
        status: 'ready',
        pauses,
        readAt: new Date().toISOString(),
        refreshing: false,
        failedAgain: false,
      }
      shownFor = key
    } catch {
      if (controller.signal.aborted) return
      anew.value = false
      // A refresh that fails keeps what it would have replaced; a read of another space, project
      // or period does not, or its tables would stand under the new scope's name.
      if (held.status === 'ready' && shownFor === key)
        read.value = { ...held, refreshing: false, failedAgain: true }
      else {
        read.value = { status: 'failed' }
        shownFor = null
      }
    }
  }

  /** What names the read: the scope and the period, a preset or its own ends. The moment
   * moving changes nothing. */
  const period = () => {
    const { period: preset, from, to } = options.view()
    return JSON.stringify({ scope: options.scope(), preset, from, to })
  }
  watch(period, () => void refresh(), { immediate: true })
  onScopeDispose(() => reading?.abort())

  return { anew, read, refresh }
}
