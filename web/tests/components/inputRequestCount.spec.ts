import { createI18n } from 'vue-i18n'

import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import InputRequestsHub from '@/features/input-requests/components/InputRequestsHub.vue'

import { fetchInputRequests } from '@/shared/api/inputRequestApi.ts'
import { messages } from '@/shared/i18n/index.ts'

import { requestList, twoQuestions, unavailableSource } from '../support/inputRequests.ts'

vi.mock('@/shared/api/inputRequestApi.ts', async (original) => ({
  ...(await original<typeof import('@/shared/api/inputRequestApi.ts')>()),
  fetchInputRequests: vi.fn(),
}))

const wrappers: ReturnType<typeof mount>[] = []

function hub(locale: 'en' | 'ru') {
  const wrapper = mount(InputRequestsHub, {
    props: { open: true },
    attachTo: document.body,
    global: {
      plugins: [createI18n({ legacy: false, locale, messages })],
      stubs: { teleport: true },
    },
  })
  wrappers.push(wrapper)
  return wrapper
}

beforeEach(() => {
  vi.resetAllMocks()
})

afterEach(() => {
  for (const wrapper of wrappers.splice(0)) wrapper.unmount()
  document.body.replaceChildren()
})

// A source that could not be read may hold more questions, so the known number
// is a floor: the dialog says so with a plus, as the rail does. A complete read
// says nothing extra.
describe('waiting count while a source is unavailable', () => {
  it('prints the floor with a plus in English and Russian, and the whole count without one', async () => {
    const coverage = [unavailableSource('detached', 'store_not_attached')]
    vi.mocked(fetchInputRequests).mockResolvedValue({ ...requestList(twoQuestions()), coverage })
    const partialEn = hub('en')
    await flushPromises()
    expect(partialEn.get('.request-status').text()).toBe('Waiting for an answer: 2+')
    expect(partialEn.emitted('count')?.at(-1)).toEqual([{ value: 2, incomplete: true }])

    vi.mocked(fetchInputRequests).mockResolvedValue(requestList(twoQuestions()))
    const wholeRu = hub('ru')
    await flushPromises()
    expect(wholeRu.get('.request-status').text()).toBe('Ждут ответа: 2')
    expect(wholeRu.emitted('count')?.at(-1)).toEqual([{ value: 2, incomplete: false }])

    vi.mocked(fetchInputRequests).mockResolvedValue({ ...requestList(twoQuestions()), coverage })
    const partialRu = hub('ru')
    await flushPromises()
    expect(partialRu.get('.request-status').text()).toBe('Ждут ответа: 2+')
  })
})
