import { defineComponent, h, ref } from 'vue'

import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, expect, it, vi } from 'vitest'

import { usePlatformLiveFeed } from '@/app/composables/usePlatformLiveFeed.ts'

import { modulesPayload } from '../support/moduleRegistrations.ts'
const fetchModules = vi.hoisted(() => vi.fn())
vi.mock('@/shared/api/platformApi.ts', () => ({ fetchModules }))
afterEach(() => vi.unstubAllGlobals())
const refreshedText = () => 'refreshed'
const renderFeed = () => h('div')
function mountFeed() {
  const notice = ref('')
  const moduleAuthorityReady = ref(false)
  let feed!: ReturnType<typeof usePlatformLiveFeed>
  const loadContext = vi.fn(async () => {})
  const syncRouteResources = vi.fn(async () => {})
  const wrapper = mount(
    defineComponent({
      setup() {
        feed = usePlatformLiveFeed({
          notice,
          moduleAuthorityReady,
          text: { failure: (failure) => `failure:${failure.code}`, refreshed: refreshedText },
          loadContext,
          syncRouteResources,
        })
        return renderFeed
      },
    }),
  )
  return { feed, notice, moduleAuthorityReady, loadContext, syncRouteResources, wrapper }
}
it('loads only module authority and context, and never opens global feeds', async () => {
  fetchModules.mockResolvedValue(modulesPayload())
  const fetch = vi.fn()
  const EventSource = vi.fn()
  vi.stubGlobal('fetch', fetch)
  vi.stubGlobal('EventSource', EventSource)
  const { feed, loadContext, syncRouteResources, wrapper } = mountFeed()
  await flushPromises()
  expect(feed.modules.value.map((module) => module.module_id)).toEqual(['planning', 'settings'])
  expect(loadContext).toHaveBeenCalledOnce()
  expect(syncRouteResources).toHaveBeenCalledOnce()
  expect(fetch).not.toHaveBeenCalled()
  expect(EventSource).not.toHaveBeenCalled()
  wrapper.unmount()
})
it('retains committed authority after refresh fails with safe typed copy', async () => {
  fetchModules.mockResolvedValue(modulesPayload())
  const { feed, notice, moduleAuthorityReady, wrapper } = mountFeed()
  await flushPromises()
  fetchModules.mockRejectedValueOnce(new Error('DISTINCT private /srv/secret'))
  await feed.refreshAll()
  expect(feed.modules.value.map((module) => module.module_id)).toEqual(['planning', 'settings'])
  expect(moduleAuthorityReady.value).toBe(true)
  expect(feed.modulesFailure.value).toEqual({
    code: 'request_failed',
    retryable: true,
    status: null,
  })
  expect(notice.value).toBe('failure:request_failed')
  expect(JSON.stringify(feed.modulesFailure.value)).not.toContain('DISTINCT')
  wrapper.unmount()
})
