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
import { messages } from '@/shared/i18n/index.ts'
import ChoiceSelect from '@/shared/ui/ChoiceSelect.vue'

import {
  answered,
  requestEntry,
  requestList,
  twoQuestions,
} from '../support/inputRequests.ts'
import { present } from '../support/present.ts'
import { answer, checkedLabels, radioLabel, radios } from '../support/radioAnswers.ts'

vi.mock('@/shared/api/inputRequestApi.ts', async (original) => ({
  ...(await original<typeof import('@/shared/api/inputRequestApi.ts')>()),
  answerInputRequest: vi.fn(),
  declineInputRequest: vi.fn(),
  fetchInputRequest: vi.fn(),
  fetchInputRequests: vi.fn(),
}))
type Wrapper = ReturnType<typeof mount>
const wrappers: Wrapper[] = []
const plugins = () => [createI18n({ legacy: false, locale: 'en', messages })]
const buttons = (wrapper: Wrapper, name: string) =>
  wrapper.findAll('button').filter((control) => control.text() === name)
const button = (wrapper: Wrapper, name: string) => present(buttons(wrapper, name)[0], name)
const choice = (wrapper: Wrapper, index = 0) =>
  present(wrapper.findAllComponents(ChoiceSelect)[index], `choice ${index + 1}`)
const updateChoice = async (wrapper: Wrapper, value: string, index = 0) => {
  choice(wrapper, index).vm.$emit('update:modelValue', value)
  await flushPromises()
}
const describedMessage = (wrapper: Wrapper, control: { attributes: (name: string) => unknown }) =>
  wrapper.get(`#${String(present(control.attributes('aria-describedby'), 'aria-describedby'))}`)
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
    attachTo: document.body,
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
    expect(buttons(wrapper, 'Open task')).toHaveLength(0)
    const inbox = hub()
    await flushPromises()
    expect(button(inbox, 'Open task').exists()).toBe(true)
  })

  // Yes/No is one click on a visible radio, with nothing chosen at first and no
  // placeholder among the answers: the dropdown it replaced listed "Choose an
  // answer" as a checked option, so one bit cost three clicks.
  it('requires an explicit boolean and sends false as an answer, without resuming execution', async () => {
    const entry = requestEntry()
    vi.mocked(answerInputRequest).mockResolvedValue({
      ...entry,
      request: { ...entry.request, status: 'answered', answers: { proceed: false }, revision: 2 },
    })
    const wrapper = card(entry)
    expect(wrapper.findComponent(ChoiceSelect).exists()).toBe(false)
    expect(radios(wrapper).map((input) => radioLabel(input))).toEqual(['Yes', 'No'])
    expect(checkedLabels(wrapper)).toEqual([])
    await button(wrapper, 'Send answer').trigger('click')
    expect(answerInputRequest).not.toHaveBeenCalled()
    await answer(wrapper, 'No')
    expect(checkedLabels(wrapper)).toEqual(['No'])
    await button(wrapper, 'Send answer').trigger('click')
    await flushPromises()
    expect(answerInputRequest).toHaveBeenCalledExactlyOnceWith(entry, { proceed: false })
    expect(wrapper.text()).toContain('Answer received')
    expect(wrapper.get('dl').text()).toContain('No')
    expect(declineInputRequest).not.toHaveBeenCalled()
  })

  // The refusal used to be one sentence at the foot of the card, tied to no
  // field, and it brought a second Refresh into a dialog that had one.
  it('names a refused field at the field itself and takes focus there', async () => {
    const entry = requestEntry()
    entry.request.fields = [
      { id: 'proceed', label: 'Proceed', type: 'boolean', required: true, options: [] },
      { id: 'note', label: 'Reason', type: 'text', required: true, options: [] },
    ]
    const wrapper = card(entry)
    const group = wrapper.get('[role="radiogroup"]')
    const note = wrapper.get('textarea')
    expect(group.attributes('aria-invalid')).toBeUndefined()
    expect(note.attributes('aria-invalid')).toBeUndefined()
    await button(wrapper, 'Send answer').trigger('click')
    await flushPromises()
    expect(answerInputRequest).not.toHaveBeenCalled()
    expect(group.attributes('aria-invalid')).toBe('true')
    expect(describedMessage(wrapper, group).text()).toBe('Choose Yes or No.')
    expect(note.attributes('aria-invalid')).toBe('true')
    expect(describedMessage(wrapper, note).text()).toBe('Write an answer.')
    expect(document.activeElement).toBe(radios(wrapper)[0]?.element)
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(buttons(wrapper, 'Check status')).toHaveLength(0)
    // Fixing one field clears its own message and leaves the other standing.
    await answer(wrapper, 'Yes')
    expect(group.attributes('aria-invalid')).toBeUndefined()
    expect(group.attributes('aria-describedby')).toBeUndefined()
    expect(note.attributes('aria-invalid')).toBe('true')
  })

  it('keeps a long choice in a list whose caption is not one of its answers', async () => {
    const entry = requestEntry()
    const ids = ['one', 'two', 'three', 'four', 'five']
    entry.request.fields = [
      {
        id: 'module',
        label: 'Module',
        type: 'choice',
        required: true,
        options: ids.map((id) => ({ id, label: id })),
      },
    ]
    const wrapper = card(entry)
    expect(wrapper.find('[role="radiogroup"]').exists()).toBe(false)
    const options = choice(wrapper).props('options') as { value: string }[]
    expect(options.map((option) => option.value)).toEqual(ids)
    expect(choice(wrapper).props('placeholder')).toBe('Choose an answer')
    await button(wrapper, 'Send answer').trigger('click')
    await flushPromises()
    expect(choice(wrapper).props('invalid')).toBe(true)
    expect(choice(wrapper).props('describedby')).toBeTruthy()
    await updateChoice(wrapper, 'five')
    expect(choice(wrapper).props('invalid')).toBe(false)
  })

  it.each([409, 503])(
    'keeps drafts on refused or unknown writes (%s) until explicit refresh',
    async (status) => {
      vi.mocked(answerInputRequest).mockRejectedValue(new InputRequestError('rejected', status))
      vi.mocked(fetchInputRequest).mockResolvedValue(requestEntry())
      const wrapper = card()
      await answer(wrapper, 'No')
      await button(wrapper, 'Send answer').trigger('click')
      await flushPromises()
      expect(checkedLabels(wrapper)).toEqual(['No'])
      expect(button(wrapper, 'Send answer').attributes('disabled')).toBeDefined()
      expect(wrapper.get('[role="alert"]').text()).toContain('draft is kept')
      await button(wrapper, 'Check status').trigger('click')
      await flushPromises()
      expect(checkedLabels(wrapper)).toEqual(['No'])
      expect(button(wrapper, 'Send answer').attributes('disabled')).toBeUndefined()
    },
  )

  it('keeps unsent drafts across polling and closing and reopening the hub', async () => {
    const wrapper = hub()
    await flushPromises()
    await answer(wrapper, 'No')
    expect(checkedLabels(wrapper)).toEqual(['No'])
    await vi.advanceTimersByTimeAsync(30_000)
    await flushPromises()
    expect(checkedLabels(wrapper)).toEqual(['No'])
    await wrapper.setProps({ open: false })
    await wrapper.setProps({ open: true })
    await flushPromises()
    expect(checkedLabels(wrapper)).toEqual(['No'])
    expect(answerInputRequest).not.toHaveBeenCalled()
  })

  it.each(['readonly', 'expired'])('prevents mutation of %s requests', async (state) => {
    const entry = requestEntry()
    if (state === 'readonly') entry.target.writable = false
    else entry.request.expires_at = '2020-01-01T00:00:00Z'
    const wrapper = card(entry)
    expect(wrapper.get('fieldset').attributes('disabled')).toBeDefined()
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
    await answer(wrapper, 'No')
    expect(checkedLabels(wrapper, 0)).toEqual(['No'])
    expect(checkedLabels(wrapper, 1)).toEqual([])
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
    expect(wrapper.find('input').exists()).toBe(false)
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
    await answer(wrapper, 'Beta')
    expect(checkedLabels(wrapper)).toEqual(['Beta'])
    await wrapper.get('input[type="checkbox"][value="alpha"]').setValue(true)
    await button(wrapper, 'Send answer').trigger('click')
    await flushPromises()
    expect(answerInputRequest).toHaveBeenCalledExactlyOnceWith(entry, answers)
    expect(wrapper.get('dl').text()).toContain('A useful reason')
    expect(wrapper.get('dl').text()).toContain('Beta')
  })

  // Answering takes away the buttons that held focus. Focus used to fall to the
  // page under the modal, the answered card moved to the end of the list, and
  // the header still counted it while the rail did not.
  it('keeps an answered question in place and moves focus and the count on', async () => {
    const [newer, older] = twoQuestions()
    vi.mocked(fetchInputRequests)
      .mockResolvedValueOnce(requestList([newer, older]))
      .mockResolvedValue(requestList([older]))
    vi.mocked(answerInputRequest).mockResolvedValueOnce(answered(newer))
    const wrapper = hub()
    await flushPromises()
    const titles = () => wrapper.findAll('.request-card h3').map((heading) => heading.text())
    expect(titles()).toEqual(['Newer question', 'Older question'])
    expect(wrapper.get('.request-status').text()).toBe('Waiting for an answer: 2')
    await answer(wrapper, 'Yes', 0)
    await button(wrapper, 'Send answer').trigger('click')
    await flushPromises()
    expect(titles()).toEqual(['Newer question', 'Older question'])
    expect(wrapper.emitted('count')?.at(-1)).toEqual([1])
    expect(wrapper.get('.request-status').text()).toBe('Waiting for an answer: 1')
    expect(document.activeElement?.textContent).toBe('Older question')
    expect(buttons(wrapper, 'Refresh')).toHaveLength(1)

    vi.mocked(answerInputRequest).mockResolvedValueOnce(answered(older))
    vi.mocked(fetchInputRequests).mockResolvedValue(requestList([]))
    await answer(wrapper, 'Yes', 0)
    await button(wrapper, 'Send answer').trigger('click')
    await flushPromises()
    expect(titles()).toEqual(['Newer question', 'Older question'])
    expect(wrapper.emitted('count')?.at(-1)).toEqual([0])
    // With nothing left to answer, focus stays in the dialog, on the line that says so.
    expect(wrapper.get('.request-status').text()).toBe('No questions need your answer.')
    expect(document.activeElement).toBe(wrapper.get('.request-status').element)
  })

  it('names the reader as the one who answered, without repeating the space key', () => {
    const own = card(answered(requestEntry()))
    expect(own.get('.request-context').text()).toBe('requests-project · TASK-7')
    expect(own.get('.request-state').text()).toMatch(/^You answered · /)
    expect(own.text()).not.toContain('user')
    const byAgent = card(answered(requestEntry(), 'codex-session-1'))
    expect(byAgent.get('.request-state').text()).toMatch(
      /^Answer received · Resolved by codex-session-1 · /,
    )
  })

  it('says "waiting for your answer" in a task, not under a dialog titled with it', async () => {
    const inbox = hub()
    await flushPromises()
    expect(inbox.find('.request-state').exists()).toBe(false)
    const item = mount(ItemInputRequests, {
      props: { target: requestEntry().target },
      global: { plugins: plugins() },
    })
    wrappers.push(item)
    await flushPromises()
    expect(item.get('.request-state').text()).toBe('Waiting for your answer')
  })
})
