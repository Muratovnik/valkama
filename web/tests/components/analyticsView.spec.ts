import { defineComponent, h, nextTick } from 'vue'
import type { PropType } from 'vue'
import { createI18n } from 'vue-i18n'

import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import AnalyticsView from '@/pages/analytics/AnalyticsView.vue'

import { planningSpaceEntity } from '@/shared/api/platformPlanningRefs.ts'
import type { PlatformUiState } from '@/shared/api/platformUiState.ts'
import { messages } from '@/shared/i18n/index.ts'
import type { DashboardFilters, DashboardPayload } from '@/shared/types/analytics.ts'

import { analyticsPayload } from '../browser/analyticsFixtures.ts'
import { dataScopeId, projectId, spaceRef } from '../browser/planningFixtures.ts'

const fetchSpaceAnalytics = vi.fn()

vi.mock('@/entities/analytics/api/analyticsApi.ts', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchSpaceAnalytics: (...args: unknown[]) => fetchSpaceAnalytics(...args),
}))

function filters(client: string | null): DashboardFilters {
  return { ...analyticsPayload.filters, client }
}

const DashboardStub = defineComponent({
  name: 'AnalyticsDashboard',
  props: {
    payload: {
      type: Object as PropType<DashboardPayload>,
      default: null,
    },
    retryable: Boolean,
    state: {
      type: Object as PropType<PlatformUiState<true>>,
      required: true,
    },
  },
  emits: ['filters', 'retry'],
  setup(props, { emit }) {
    return () =>
      h('section', { 'class': 'dashboard-stub', 'data-status': props.state.status }, [
        props.payload
          ? h(
              'span',
              { class: 'dashboard-reading' },
              `${props.payload.filters.client ?? 'all'}:${props.payload.as_of}`,
            )
          : null,
        'reason' in props.state
          ? h('span', { class: 'dashboard-reason' }, props.state.reason ?? '')
          : null,
        h('button', { class: 'dashboard-retry', onClick: () => emit('retry') }, 'retry'),
        h(
          'button',
          { class: 'filter-claude', onClick: () => emit('filters', filters('claude')) },
          'claude',
        ),
        h(
          'button',
          { class: 'filter-codex', onClick: () => emit('filters', filters('codex')) },
          'codex',
        ),
      ])
  },
})

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, reject, resolve }
}

function reading(client: string | null, asOf: string): DashboardPayload {
  const payload = structuredClone(analyticsPayload)
  payload.as_of = asOf
  payload.filters = filters(client)
  return payload
}

function mountView() {
  return mount(AnalyticsView, {
    props: {
      context: null,
      primaryWriteScopeId: dataScopeId,
      scope: { kind: 'project', project_ref: { project_id: projectId } },
      entity: planningSpaceEntity(spaceRef),
    },
    global: {
      plugins: [createI18n({ legacy: false, locale: 'en', fallbackLocale: 'en', messages })],
      stubs: { AnalyticsDashboard: DashboardStub, AnalyticsPortfolio: true },
    },
  })
}

describe('analytics dashboard resource lifecycle', () => {
  beforeEach(() => fetchSpaceAnalytics.mockReset())

  it('renders a cold typed failure as an error and retries without backend prose', async () => {
    fetchSpaceAnalytics.mockRejectedValueOnce(
      Object.assign(new Error('private backend prose'), { status: 500 }),
    )
    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.get('.dashboard-stub').attributes('data-status')).toBe('error')
    expect(wrapper.text()).toContain('The local service did not complete the request.')
    expect(wrapper.text()).not.toContain('private backend prose')
    expect(wrapper.text()).not.toContain('No data')

    fetchSpaceAnalytics.mockResolvedValueOnce(reading(null, '2026-08-27T12:00:00Z'))
    await wrapper.get('.dashboard-retry').trigger('click')
    await flushPromises()

    expect(wrapper.get('.dashboard-stub').attributes('data-status')).toBe('ready')
    expect(fetchSpaceAnalytics).toHaveBeenCalledTimes(2)
  })

  it('keeps same-key content through refresh and degraded retry', async () => {
    fetchSpaceAnalytics.mockResolvedValueOnce(reading(null, '2026-08-27T12:00:00Z'))
    const wrapper = mountView()
    await flushPromises()

    const refresh = deferred<DashboardPayload>()
    fetchSpaceAnalytics.mockReturnValueOnce(refresh.promise)
    await wrapper.get('.dashboard-retry').trigger('click')
    await nextTick()

    expect(wrapper.get('.dashboard-stub').attributes('data-status')).toBe('degraded')
    expect(wrapper.text()).toContain('all:2026-08-27T12:00:00Z')

    refresh.reject({ code: 'request_failed', status: 500, retryable: true })
    await flushPromises()
    expect(wrapper.text()).toContain('all:2026-08-27T12:00:00Z')
    expect(wrapper.text()).toContain('The local service did not complete the request.')

    fetchSpaceAnalytics.mockResolvedValueOnce(reading(null, '2026-08-27T13:00:00Z'))
    await wrapper.get('.dashboard-retry').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('all:2026-08-27T13:00:00Z')
  })

  it('commits only the newest filter request when responses finish out of order', async () => {
    fetchSpaceAnalytics.mockResolvedValueOnce(reading(null, '2026-08-27T12:00:00Z'))
    const wrapper = mountView()
    await flushPromises()

    const older = deferred<DashboardPayload>()
    const newer = deferred<DashboardPayload>()
    fetchSpaceAnalytics.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise)

    await wrapper.get('.filter-claude').trigger('click')
    await wrapper.get('.filter-codex').trigger('click')
    newer.resolve(reading('codex', '2026-08-27T14:00:00Z'))
    await flushPromises()
    older.resolve(reading('claude', '2026-08-27T13:00:00Z'))
    await flushPromises()

    expect(wrapper.text()).toContain('codex:2026-08-27T14:00:00Z')
    expect(wrapper.text()).not.toContain('claude:2026-08-27T13:00:00Z')
    expect(fetchSpaceAnalytics).toHaveBeenCalledTimes(3)
  })
})
