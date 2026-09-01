/**
 * The numbers behind a chart, and the URL that says which chart.
 *
 * The table is a URL-owned surface: `?analyticsTable=flow` opens it, so a reader can
 * send someone the figures rather than the picture, and Back closes it. Closing has
 * two paths on purpose — `history.back()` when this app pushed the entry, and a
 * `replaceState` when it did not, because a query parameter that arrived with the
 * link is not an entry to step back over.
 *
 * Each of the six keys names its own columns, because a table of tool calls and a
 * table of token days share nothing but the shape of a table.
 */

import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import type { AnalyticsTableColumn } from '@/widgets/analytics-dashboard/components/AnalyticsTableInspector.vue'
import { analyticsFormatters } from '@/widgets/analytics-dashboard/utils/analyticsFormat.ts'
import { classifyToolUsage } from '@/widgets/analytics-dashboard/utils/chartOptions.ts'

import type { DashboardPayload } from '@/shared/types/analytics.ts'

export type AnalyticsTableKey =
  'executions' | 'flow' | 'runtime' | 'throughput' | 'tokens' | 'tools'

const TABLE_KEYS: Set<AnalyticsTableKey> = new Set([
  'throughput',
  'flow',
  'tools',
  'runtime',
  'tokens',
  'executions',
])

type AnalyticsTable = {
  caption: string
  columns: AnalyticsTableColumn[]
  rows: Record<string, string | number>[]
  title: string
}

function tableFromUrl(): AnalyticsTableKey | null {
  if (typeof location === 'undefined') return null
  const value = new URL(location.href).searchParams.get(
    'analyticsTable',
  ) as AnalyticsTableKey | null
  return value && TABLE_KEYS.has(value) ? value : null
}

export function useAnalyticsTable(payloadOf: () => DashboardPayload | null) {
  const { t } = useI18n()
  const format = analyticsFormatters(t)
  const openKey = ref<AnalyticsTableKey | null>(null)

  /** Who answered for one attempt, or that nobody did. */
  function attemptSource(source: { adapter_id: string; quality: string }): string {
    const quality = t(`usage.coverageState.${source.quality}`)
    return source.adapter_id ? `${source.adapter_id} · ${quality}` : quality
  }

  function syncFromUrl() {
    openKey.value = tableFromUrl()
  }

  function openTable(key: AnalyticsTableKey) {
    if (typeof history !== 'undefined') {
      const url = new URL(location.href)
      url.searchParams.set('analyticsTable', key)
      history.pushState({ ...history.state, analyticsTable: key }, '', url)
    }
    openKey.value = key
  }

  function closeTable() {
    if (typeof history === 'undefined') {
      openKey.value = null
      return
    }
    if (history.state?.analyticsTable) history.back()
    else {
      const url = new URL(location.href)
      url.searchParams.delete('analyticsTable')
      history.replaceState(history.state, '', url)
      openKey.value = null
    }
  }

  const table = computed<AnalyticsTable | null>(() => {
    const payload = payloadOf()
    const key = openKey.value
    if (!payload || !key) return null
    if (key === 'throughput')
      return {
        title: t('dashboard.throughputSeries'),
        caption: t('dashboard.throughputHint'),
        columns: [
          { key: 'date', label: t('dashboard.date') },
          { key: 'value', label: t('dashboard.completed') },
        ],
        rows: payload.throughput.map((row) => ({ date: row.date, value: row.count })),
      }
    if (key === 'flow') {
      const flowTotal =
        payload.states.reduce((sum, state) => sum + (payload.flow[state.key] ?? 0), 0) +
        payload.flow.unknown
      return {
        title: t('dashboard.flow'),
        caption: t('dashboard.flowCount', { count: flowTotal }),
        columns: [
          { key: 'status', label: t('dashboard.status') },
          { key: 'value', label: t('dashboard.inventory') },
        ],
        rows: [
          ...payload.states.map((state) => ({
            status: state.key,
            value: payload.flow[state.key] ?? 0,
          })),
          ...(payload.flow.unknown
            ? [{ status: t('dashboard.unknown'), value: payload.flow.unknown }]
            : []),
        ],
      }
    }
    if (key === 'executions') {
      const rows = payload.executions.attempt_rows
      return {
        title: t('dashboard.attemptSection'),
        caption: t('dashboard.attemptRowsCaption', {
          shown: rows.length,
          attempts: payload.executions.attempts,
        }),
        columns: [
          { key: 'workItem', label: t('dashboard.attemptWorkItem') },
          { key: 'status', label: t('dashboard.status') },
          { key: 'client', label: t('dashboard.filterClient') },
          { key: 'model', label: t('dashboard.attemptModel') },
          { key: 'wall', label: t('dashboard.agentTime') },
          { key: 'tokens', label: t('dashboard.tokens') },
          { key: 'source', label: t('dashboard.provenance') },
          { key: 'sessions', label: t('dashboard.sessions') },
        ],
        rows: rows.map((row) => ({
          workItem: row.work_item,
          status: t(`execution.status.${row.status}`),
          client: format.nameLabel(row.client_family),
          model: format.nameLabel(row.model),
          wall: format.duration(row.wall_seconds),
          // The row's own quality, not the block's. A space that is half
          // observed says `partial` once at the top; this is where a reader
          // finds out which half an attempt is in.
          tokens: format.value(row.tokens),
          source: attemptSource(row.source),
          // Nothing here resolves a session — it is a pointer into the
          // client's own journal — but naming it is what lets a reader look.
          sessions: row.sessions.join(', '),
        })),
      }
    }
    if (key === 'tools')
      return {
        title: t('dashboard.toolUsage'),
        caption: t('dashboard.sessionAnalytics'),
        columns: [
          { key: 'name', label: t('dashboard.tools') },
          { key: 'calls', label: t('dashboard.calls') },
          { key: 'success', label: t('dashboard.successfulCalls') },
          { key: 'failed', label: t('dashboard.failedCalls') },
          { key: 'other', label: t('dashboard.unclassifiedCalls') },
        ],
        rows: classifyToolUsage(payload.session_analytics.tool_usage).map((row) => ({
          name: row.name,
          calls: format.value(row.calls),
          success: format.value(row.success),
          failed: format.value(row.error),
          other: format.value(row.unclassified),
        })),
      }
    if (key === 'runtime')
      return {
        title: t('dashboard.runtimeDistribution'),
        caption: t('dashboard.sessionAnalytics'),
        columns: [
          { key: 'name', label: t('dashboard.filterEnvironment') },
          { key: 'sessions', label: t('dashboard.sessions') },
          { key: 'events', label: t('dashboard.events') },
        ],
        rows: payload.session_analytics.runtime.map((row) => ({
          name: format.nameLabel(row.name),
          sessions: format.value(row.sessions),
          events: format.value(row.events),
        })),
      }
    return {
      title: t('dashboard.tokenTrend'),
      caption: t('dashboard.usageSource', { count: payload.usage.observed_sessions }),
      columns: [
        { key: 'date', label: t('dashboard.date') },
        { key: 'usage', label: t('dashboard.usage') },
        { key: 'observation', label: t('dashboard.observation') },
        { key: 'provenance', label: t('dashboard.provenance') },
      ],
      rows: payload.usage.token_daily.map((row) => ({
        date: row.date,
        usage: format.value(format.tokenCount(row.tokens)),
        observation: row.observation,
        provenance: format.tokenProvenance(row.quality, row.reason, row.shared),
      })),
    }
  })

  onMounted(() => {
    syncFromUrl()
    window.addEventListener('popstate', syncFromUrl)
  })
  onBeforeUnmount(() => window.removeEventListener('popstate', syncFromUrl))

  return { closeTable, openTable, table }
}
