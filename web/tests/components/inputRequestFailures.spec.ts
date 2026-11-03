import { createI18n } from 'vue-i18n'

import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import InputRequestsHub from '@/features/input-requests/components/InputRequestsHub.vue'
import RequestCard from '@/features/input-requests/components/RequestCard.vue'
import { EMPTY_DRAFT } from '@/features/input-requests/utils/validateAnswers.ts'

import {
  declineInputRequest,
  fetchInputRequests,
  InputRequestError,
} from '@/shared/api/inputRequestApi.ts'
import { messages } from '@/shared/i18n/index.ts'

import { requestEntry, requestList } from '../support/inputRequests.ts'
import { present } from '../support/present.ts'
import { answer, radios } from '../support/radioAnswers.ts'

vi.mock('@/shared/api/inputRequestApi.ts', async (original) => ({
  ...(await original<typeof import('@/shared/api/inputRequestApi.ts')>()),
  declineInputRequest: vi.fn(),
  fetchInputRequests: vi.fn(),
}))
type Wrapper = ReturnType<typeof mount>
const wrappers: Wrapper[] = []
const global = { plugins: [createI18n({ legacy: false, locale: 'en', messages })] }
const button = (wrapper: Wrapper, name: string) =>
  present(
    wrapper.findAll('button').find((control) => control.text() === name),
    name,
  )
function mounted(wrapper: Wrapper) {
  wrappers.push(wrapper)
  return wrapper
}
const hub = () =>
  mounted(
    mount(InputRequestsHub, {
      props: { open: true },
      attachTo: document.body,
      global: { ...global, stubs: { teleport: true } },
    }),
  )
const card = () =>
  mounted(
    mount(RequestCard, {
      props: { entry: requestEntry(), draft: EMPTY_DRAFT },
      attachTo: document.body,
      global,
    }),
  )
beforeEach(() => {
  vi.useFakeTimers()
  vi.resetAllMocks()
  vi.mocked(fetchInputRequests).mockResolvedValue(requestList())
})
afterEach(async () => {
  for (const wrapper of wrappers.splice(0)) wrapper.unmount()
  await flushPromises()
  vi.useRealTimers()
  document.body.replaceChildren()
})

// A failed read or write used to disable the control that held focus, which
// dropped focus to the page under the dialog, where Escape no longer reached it,
// and its sentence promised a kept draft whether or not anything was typed.
describe('a question that could not be read or sent', () => {
  it('says drafts are kept only when one exists, and takes focus to the failure it reports', async () => {
    const wrapper = hub()
    await flushPromises()
    vi.mocked(fetchInputRequests).mockRejectedValue(new Error('offline'))
    const refresh = button(wrapper, 'Refresh')
    ;(refresh.element as HTMLElement).focus()
    await refresh.trigger('click')
    expect(refresh.attributes('disabled')).toBeUndefined()
    await flushPromises()
    const failure = wrapper.get('.request-toolbar [role="alert"]')
    expect(failure.text()).toBe('Questions could not be refreshed.')
    expect(document.activeElement).toBe(failure.element)
    await answer(wrapper, 'No')
    expect(wrapper.get('.request-toolbar [role="alert"]').text()).toBe(
      'Questions could not be refreshed. Your drafts are kept.',
    )
    // A poll that fails says so without taking focus from the field being answered.
    const field = radios(wrapper)[0]?.element as HTMLElement
    field.focus()
    await vi.advanceTimersByTimeAsync(30_000)
    await flushPromises()
    expect(document.activeElement).toBe(field)
  })

  it('does not promise a kept draft after a refused decline with nothing typed', async () => {
    vi.mocked(declineInputRequest).mockRejectedValue(new InputRequestError('rejected', 409))
    const wrapper = card()
    await button(wrapper, "Don't answer").trigger('click')
    await button(wrapper, "Don't answer").trigger('click')
    await flushPromises()
    const reason = wrapper.get('[role="alert"]')
    expect(reason.text()).toBe('This request changed or closed. Check its status.')
    expect(document.activeElement).toBe(reason.element)
  })
})
