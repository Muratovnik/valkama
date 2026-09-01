import { createI18n } from 'vue-i18n'

import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'

import AnalyticsDashboard from '@/widgets/analytics-dashboard/components/AnalyticsDashboard.vue'

import { uiDegraded, uiReady } from '@/shared/api/platformUiState.ts'
import { messages } from '@/shared/i18n/index.ts'

import { analyticsPayload } from '../browser/analyticsFixtures.ts'

const FlowStub = {
  emits: ['open-table'],
  template:
    '<button class="open-flow-table" @click="$emit(\'open-table\', \'flow\')">flow table</button>',
}

const InspectorStub = {
  props: { open: Boolean, title: { type: String, default: '' } },
  template: '<aside class="analytics-inspector-stub">{{ title }}</aside>',
}

function mountDashboard() {
  const payload = structuredClone(analyticsPayload)
  payload.filters.client = 'codex'
  payload.filters.date_from = '2026-08-01T00:00:00Z'

  return mount(AnalyticsDashboard, {
    props: {
      open: true,
      payload,
      retryable: true,
      state: uiReady(true),
    },
    global: {
      plugins: [createI18n({ legacy: false, locale: 'en', fallbackLocale: 'en', messages })],
      stubs: {
        AnalyticsAgentSection: true,
        AnalyticsCardTable: true,
        AnalyticsExecutionSection: true,
        AnalyticsFlowSection: FlowStub,
        AnalyticsTableInspector: InspectorStub,
        InfoTip: true,
      },
    },
  })
}

afterEach(() => history.replaceState({}, '', location.pathname))

describe('analytics dashboard state continuity', () => {
  it('keeps filters and the URL-owned inspector mounted while a reading degrades', async () => {
    const wrapper = mountDashboard()
    await wrapper.get('.filter-toggle').trigger('click')
    const filterToggle = wrapper.get('.filter-toggle').element

    await wrapper.get('.open-flow-table').trigger('click')
    const inspector = wrapper.get('.analytics-inspector-stub').element
    expect(new URL(location.href).searchParams.get('analyticsTable')).toBe('flow')

    const exports = wrapper.findAll('.export-link')
    expect(exports[1].attributes('href')).toBe(
      '/api/dashboard/export?space=MAIN&format=json&client=codex&date_from=2026-08-01T00%3A00%3A00Z',
    )

    await wrapper.setProps({
      state: uiDegraded(true, '2026-08-27T12:00:00Z', 'platform.failures.requestFailed'),
    })

    expect(wrapper.get('.filter-toggle').element).toBe(filterToggle)
    expect(wrapper.get('.analytics-inspector-stub').element).toBe(inspector)
    expect(wrapper.get('.analytics-filters').exists()).toBe(true)
    expect(wrapper.get('.platform-state-banner').text()).toContain(
      'The local service did not complete the request.',
    )

    await wrapper.get('.dashboard-recovery button').trigger('click')
    expect(wrapper.emitted('retry')).toHaveLength(1)
  })
})
