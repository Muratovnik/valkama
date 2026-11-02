/**
 * The questions' section on a card: absent while there is none, with the read still
 * going, and present while the read cannot say there is none. Coming back on a
 * question is the browser suite's, which has the card around it.
 */
import { createI18n } from 'vue-i18n'

import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import ItemInputRequests from '@/features/input-requests/components/ItemInputRequests.vue'

import { fetchInputRequests } from '@/shared/api/inputRequestApi.ts'
import { messages } from '@/shared/i18n/index.ts'

import { requestEntry, requestList, unavailableSource } from '../support/inputRequests.ts'

vi.mock('@/shared/api/inputRequestApi.ts', async (original) => ({
  ...(await original<typeof import('@/shared/api/inputRequestApi.ts')>()),
  fetchInputRequests: vi.fn(),
}))

function section() {
  return mount(ItemInputRequests, {
    props: { target: requestEntry().target },
    global: { plugins: [createI18n({ legacy: false, locale: 'en', messages })] },
  })
}

describe('a card’s questions', () => {
  afterEach(() => {
    vi.mocked(fetchInputRequests).mockReset()
  })

  it('draw nothing while the first read runs or when it finds none', async () => {
    vi.mocked(fetchInputRequests).mockResolvedValue(requestList([]))
    const wrapper = section()
    expect(wrapper.find('.item-input-requests').exists()).toBe(false)
    await flushPromises()
    expect(wrapper.find('.item-input-requests').exists()).toBe(false)
    wrapper.unmount()
  })

  it('stand while a source went unread, since that is not the same as none', async () => {
    vi.mocked(fetchInputRequests).mockResolvedValue({
      ...requestList([]),
      coverage: [unavailableSource('failing', 'requests_unavailable')],
    })
    const wrapper = section()
    await flushPromises()
    expect(wrapper.get('.item-input-requests').text()).toContain('Some sources are unavailable')
    wrapper.unmount()
  })

  it('stand while the read failed', async () => {
    vi.mocked(fetchInputRequests).mockRejectedValue(new Error('down'))
    const wrapper = section()
    await flushPromises()
    expect(wrapper.get('.item-input-requests').find('[role="alert"]').exists()).toBe(true)
    wrapper.unmount()
  })
})
