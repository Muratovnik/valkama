import { createI18n } from 'vue-i18n'
import { createMemoryHistory, createRouter, RouterLink } from 'vue-router'

import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import AnalyticsPortfolio from '@/pages/analytics/components/AnalyticsPortfolio.vue'

import { planningSpaceRef } from '@/shared/api/platformPlanningRefs.ts'
import { parsePlatformRoute } from '@/shared/api/platformRoute.ts'
import { messages } from '@/shared/i18n/index.ts'

import { portfolioPayload } from '../browser/analyticsFixtures.ts'
import { dataScopeId } from '../browser/planningFixtures.ts'

const fetchAnalyticsPortfolio = vi.fn()

vi.mock('@/entities/analytics/api/analyticsApi.ts', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchAnalyticsPortfolio: (...args: unknown[]) => fetchAnalyticsPortfolio(...args),
}))

async function mountPortfolio() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:pathMatch(.*)*', component: { template: '<main />' } }],
  })
  await router.push('/modules/analytics/global')
  await router.isReady()

  return mount(AnalyticsPortfolio, {
    props: { dataScopeId },
    global: {
      plugins: [
        createI18n({ legacy: false, locale: 'en', fallbackLocale: 'en', messages }),
        router,
      ],
    },
  })
}

describe('analytics portfolio resource lifecycle', () => {
  beforeEach(() => fetchAnalyticsPortfolio.mockReset())

  it('shows a cold failure as an error, retries, and routes the validated reading exactly', async () => {
    fetchAnalyticsPortfolio.mockRejectedValueOnce(
      Object.assign(new Error('private backend prose'), { status: 500 }),
    )
    const wrapper = await mountPortfolio()
    await flushPromises()

    expect(wrapper.get('.platform-state-panel').attributes('data-tone')).toBe('danger')
    expect(wrapper.text()).toContain('The local service did not complete the request.')
    expect(wrapper.text()).not.toContain('private backend prose')
    expect(wrapper.find('.portfolio-reading').exists()).toBe(false)

    fetchAnalyticsPortfolio.mockResolvedValueOnce(structuredClone(portfolioPayload))
    await wrapper.get('.platform-state-retry').trigger('click')
    await flushPromises()

    expect(wrapper.get('.portfolio-reading').exists()).toBe(true)
    const link = wrapper.findComponent(RouterLink)
    const target: unknown = link.props('to')
    if (typeof target !== 'string') throw new TypeError('expected an exact serialized route')
    const route = parsePlatformRoute(target)
    expect(route.module_id).toBe('analytics')
    expect(route.scope).toEqual({
      kind: 'project',
      project_ref: { project_id: portfolioPayload.projects[0].project_id },
    })
    expect(planningSpaceRef(route.entity)).toEqual({
      data_scope_id: dataScopeId,
      space_key: portfolioPayload.projects[0].space_key,
    })
    expect(fetchAnalyticsPortfolio).toHaveBeenCalledTimes(2)
  })
})
