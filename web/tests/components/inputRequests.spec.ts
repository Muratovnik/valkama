import { createI18n } from 'vue-i18n'

import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import InputRequestsHub from '@/features/input-requests/components/InputRequestsHub.vue'
import ItemInputRequests from '@/features/input-requests/components/ItemInputRequests.vue'
import RequestCard from '@/features/input-requests/components/RequestCard.vue'

import {
  answerInputRequest,
  declineInputRequest,
  fetchInputRequest,
  fetchInputRequests,
  InputRequestError,
} from '@/shared/api/inputRequestApi.ts'
import type { InputRequestList } from '@/shared/api/inputRequestModel.ts'
import { inputRequestMessages } from '@/shared/i18n/inputRequestMessages.ts'
import ChoiceSelect from '@/shared/ui/ChoiceSelect.vue'

import { requestEntry, requestList } from '../support/inputRequests.ts'
import { present } from '../support/present.ts'

vi.mock('@/shared/api/inputRequestApi.ts', async (original) => ({
  ...(await original<typeof import('@/shared/api/inputRequestApi.ts')>()),
  answerInputRequest: vi.fn(),
  declineInputRequest: vi.fn(),
  fetchInputRequest: vi.fn(),
  fetchInputRequests: vi.fn(),
}))
const wrappers: ReturnType<typeof mount>[] = []
const plugins = () => [createI18n({ legacy: false, locale: 'en', messages: inputRequestMessages })]
const button = (wrapper: ReturnType<typeof mount>, name: string) =>
  present(
    wrapper.findAll('button').find((control) => control.text() === name),
    name,
  )
const choice = (wrapper: ReturnType<typeof mount>, index = 0) =>
  present(wrapper.findAllComponents(ChoiceSelect)[index], `choice ${index + 1}`)
const updateChoice = async (wrapper: ReturnType<typeof mount>, value: string, index = 0) => {
  choice(wrapper, index).vm.$emit('update:modelValue', value)
  await flushPromises()
}
function hub() {
  const wrapper = mount(InputRequestsHub, {
    props: { open: true },
    attachTo: document.body,
    global: { plugins: plugins(), stubs: { teleport: true } },
  })
  wrappers.push(wrapper)
  return wrapper
}
function card(entry = requestEntry()) {
  const wrapper = mount(RequestCard, {
    props: {
      entry,
      'draft': {},
      'onUpdate:draft': (draft) => {
        void wrapper.setProps({ draft })
      },
    },
    global: { plugins: plugins() },
  })
  wrappers.push(wrapper)
  return wrapper
}
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

describe('human input requests', () => {
  it('shows task navigation in the inbox and omits the dead link inside the task itself', async () => {
    const wrapper = mount(ItemInputRequests, {
      props: { target: requestEntry().target },
      global: { plugins: plugins() },
    })
    wrappers.push(wrapper)
    await flushPromises()
    expect(wrapper.findAll('button').some((control) => control.text() === 'Open task')).toBe(false)
    const inbox = hub()
    await flushPromises()
    expect(button(inbox, 'Open task').exists()).toBe(true)
  })
  it('requires an explicit boolean and sends false as an answer, without resuming execution', async () => {
    const entry = requestEntry()
    vi.mocked(answerInputRequest).mockResolvedValue({
      ...entry,
      request: { ...entry.request, status: 'answered', answers: { proceed: false }, revision: 2 },
    })
    const wrapper = card(entry)
    expect(choice(wrapper).props('options')).toEqual([
      { value: '', label: 'Choose an answer' },
      { value: 'true', label: 'Yes' },
      { value: 'false', label: 'No' },
    ])
    expect(choice(wrapper).props('modelValue')).toBe('')
    await button(wrapper, 'Send answer').trigger('click')
    expect(answerInputRequest).not.toHaveBeenCalled()
    expect(wrapper.get('[role="alert"]').text()).toContain('required field')
    await updateChoice(wrapper, 'false')
    expect(choice(wrapper).props('modelValue')).toBe('false')
    await updateChoice(wrapper, '')
    expect(choice(wrapper).props('modelValue')).toBe('')
    await button(wrapper, 'Send answer').trigger('click')
    expect(answerInputRequest).not.toHaveBeenCalled()
    expect(wrapper.get('[role="alert"]').text()).toContain('required field')
    await updateChoice(wrapper, 'false')
    await button(wrapper, 'Send answer').trigger('click')
    await flushPromises()
    expect(answerInputRequest).toHaveBeenCalledExactlyOnceWith(entry, { proceed: false })
    expect(wrapper.text()).toContain('Answer received')
    expect(wrapper.get('dl').text()).toContain('No')
    expect(declineInputRequest).not.toHaveBeenCalled()
  })

  it.each([409, 503])(
    'keeps drafts on refused or unknown writes (%s) until explicit refresh',
    async (status) => {
      vi.mocked(answerInputRequest).mockRejectedValue(new InputRequestError('rejected', status))
      vi.mocked(fetchInputRequest).mockResolvedValue(requestEntry())
      const wrapper = card()
      await updateChoice(wrapper, 'false')
      await button(wrapper, 'Send answer').trigger('click')
      await flushPromises()
      expect(choice(wrapper).props('modelValue')).toBe('false')
      expect(button(wrapper, 'Send answer').attributes('disabled')).toBeDefined()
      expect(wrapper.get('[role="alert"]').text()).toContain('draft is kept')
      await button(wrapper, 'Refresh').trigger('click')
      await flushPromises()
      expect(choice(wrapper).props('modelValue')).toBe('false')
      expect(button(wrapper, 'Send answer').attributes('disabled')).toBeUndefined()
    },
  )

  it('keeps unsent drafts across polling and closing and reopening the hub', async () => {
    const wrapper = hub()
    await flushPromises()
    await updateChoice(wrapper, 'false')
    expect(choice(wrapper).props('modelValue')).toBe('false')
    await vi.advanceTimersByTimeAsync(30_000)
    await flushPromises()
    expect(choice(wrapper).props('modelValue')).toBe('false')
    await wrapper.setProps({ open: false })
    await wrapper.setProps({ open: true })
    await flushPromises()
    expect(choice(wrapper).props('modelValue')).toBe('false')
    expect(answerInputRequest).not.toHaveBeenCalled()
  })

  it.each(['readonly', 'expired'])('prevents mutation of %s requests', async (state) => {
    const entry = requestEntry()
    if (state === 'readonly') entry.target.writable = false
    else entry.request.expires_at = '2020-01-01T00:00:00Z'
    const wrapper = card(entry)
    expect(choice(wrapper).props('disabled')).toBe(true)
    await button(wrapper, 'Send answer').trigger('click')
    await button(wrapper, 'Decline').trigger('click')
    expect(answerInputRequest).not.toHaveBeenCalled()
    expect(declineInputRequest).not.toHaveBeenCalled()
  })

  it('treats unavailable and truncated counts as unknown and never calls an error an empty result', async () => {
    vi.mocked(fetchInputRequests)
      .mockResolvedValueOnce({ ...requestList([]), has_more: true })
      .mockRejectedValueOnce(new Error('offline'))
    const wrapper = hub()
    await flushPromises()
    expect(wrapper.emitted('count')?.at(-1)).toEqual([null])
    expect(wrapper.text()).toContain('first 100')
    await button(wrapper, 'Refresh').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('could not be refreshed')
    expect(wrapper.text()).not.toContain('No questions need')
  })

  it('aborts obsolete item reads, ignores late responses and keeps same-reference sources distinct', async () => {
    let finishOld: (value: InputRequestList) => void = vi.fn()
    const second = requestEntry()
    second.target = { ...second.target, project_id: 'another-project' }
    second.request = { ...second.request, title: 'Second source' }
    vi.mocked(fetchInputRequests)
      .mockReturnValueOnce(
        new Promise((resolve) => {
          finishOld = resolve
        }),
      )
      .mockResolvedValueOnce(requestList([second]))
    const wrapper = mount(ItemInputRequests, {
      props: { target: requestEntry().target },
      global: { plugins: plugins() },
    })
    wrappers.push(wrapper)
    const signal = present(vi.mocked(fetchInputRequests).mock.calls[0], 'first read')[0]?.signal
    await wrapper.setProps({ target: second.target })
    await flushPromises()
    expect(signal?.aborted).toBe(true)
    finishOld(requestList())
    await flushPromises()
    expect(wrapper.text()).toContain('Second source')
    expect(wrapper.text()).not.toContain('Confirm deployment')
  })

  it('keeps source identities separate even when request and task identifiers match', async () => {
    const second = requestEntry()
    second.target = {
      ...second.target,
      space_ref: {
        ...second.target.space_ref,
        data_scope_id: '44444444-4444-4444-8444-444444444444',
      },
    }
    vi.mocked(fetchInputRequests).mockResolvedValue(requestList([requestEntry(), second]))
    const wrapper = hub()
    await flushPromises()
    await updateChoice(wrapper, 'false')
    expect(choice(wrapper, 0).props('modelValue')).toBe('false')
    expect(choice(wrapper, 1).props('modelValue')).toBe('')
  })

  it('declines without inventing an answer and shows the confirmed result', async () => {
    const entry = requestEntry()
    vi.mocked(declineInputRequest).mockResolvedValue({
      ...entry,
      request: { ...entry.request, status: 'declined', revision: 2 },
    })
    const wrapper = card(entry)
    await button(wrapper, 'Decline').trigger('click')
    await flushPromises()
    expect(declineInputRequest).toHaveBeenCalledExactlyOnceWith(entry)
    expect(answerInputRequest).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('Declined')
    expect(wrapper.findComponent(ChoiceSelect).exists()).toBe(false)
  })

  it('prevents overlapping polls and aborts outstanding reads on unmount', async () => {
    vi.mocked(fetchInputRequests).mockReturnValue(new Promise(() => {}))
    const wrapper = hub()
    const signal = present(vi.mocked(fetchInputRequests).mock.calls[0], 'pending read')[0]?.signal
    window.dispatchEvent(new Event('focus'))
    await vi.advanceTimersByTimeAsync(60_000)
    expect(fetchInputRequests).toHaveBeenCalledTimes(1)
    wrapper.unmount()
    wrappers.splice(wrappers.indexOf(wrapper), 1)
    expect(signal?.aborted).toBe(true)
    window.dispatchEvent(new Event('focus'))
    await vi.advanceTimersByTimeAsync(30_000)
    expect(fetchInputRequests).toHaveBeenCalledTimes(1)
  })

  it('submits text, single and multiple choice values through the request field facade', async () => {
    const entry = requestEntry()
    const options = [
      { id: 'alpha', label: 'Alpha' },
      { id: 'beta', label: 'Beta' },
    ]
    entry.request.fields = [
      { id: 'note', label: 'Reason', type: 'text', required: true, options: [] },
      { id: 'one', label: 'One', type: 'choice', required: true, options },
      { id: 'many', label: 'Many', type: 'multi_choice', required: true, options },
    ]
    const answers = { note: 'A useful reason', one: 'beta', many: ['alpha'] }
    vi.mocked(answerInputRequest).mockResolvedValue({
      ...entry,
      request: { ...entry.request, status: 'answered', answers, revision: 2 },
    })
    const wrapper = card(entry)
    await wrapper.get('textarea').setValue('A useful reason')
    expect(choice(wrapper).props('options')).toEqual([
      { value: '', label: 'Choose an answer' },
      { value: 'alpha', label: 'Alpha' },
      { value: 'beta', label: 'Beta' },
    ])
    await updateChoice(wrapper, 'beta')
    expect(choice(wrapper).props('modelValue')).toBe('beta')
    await wrapper.get('input[value="alpha"]').setValue(true)
    await button(wrapper, 'Send answer').trigger('click')
    await flushPromises()
    expect(answerInputRequest).toHaveBeenCalledExactlyOnceWith(entry, answers)
    expect(wrapper.get('dl').text()).toContain('A useful reason')
    expect(wrapper.get('dl').text()).toContain('Beta')
  })
})
