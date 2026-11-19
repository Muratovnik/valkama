/**
 * Accepting what is recommended in several blocks at once, in the list of everything waiting:
 * nothing is chosen until the person presses, nothing is sent until they press again, and each
 * block is written by its own record, so one that did not go keeps what was filled and says why.
 */
import { createI18n } from 'vue-i18n'

import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import RequestList from '@/features/input-requests/components/RequestList.vue'
import { requestIdentity } from '@/features/input-requests/utils/requestIdentity.ts'
import type { RequestDraft } from '@/features/input-requests/utils/validateAnswers.ts'

import { answerInputRequest, InputRequestError } from '@/shared/api/inputRequestApi.ts'
import type { InputRequestEntry, InputRequestField } from '@/shared/api/inputRequestModel.ts'
import { messages } from '@/shared/i18n/index.ts'

import { firstAnswer, requestEntry, requestList } from '../support/inputRequests.ts'
import { present } from '../support/present.ts'
import { checkedLabels } from '../support/radioAnswers.ts'

vi.mock('@/shared/api/inputRequestApi.ts', async (original) => ({
  ...(await original<typeof import('@/shared/api/inputRequestApi.ts')>()),
  answerInputRequest: vi.fn(),
}))

type Wrapper = VueWrapper
const wrappers: Wrapper[] = []

const recommends: InputRequestField = {
  id: 'route',
  label: 'Route',
  type: 'choice',
  required: true,
  options: [
    { id: 'keep', label: 'Keep' },
    { id: 'merge', label: 'Merge', recommended: true },
  ],
}
const recommendsNothing: InputRequestField = {
  ...recommends,
  options: [
    { id: 'keep', label: 'Keep' },
    { id: 'merge', label: 'Merge' },
  ],
}
function question(id: string, title: string, field: InputRequestField): InputRequestEntry {
  const entry = requestEntry()
  entry.request = {
    ...entry.request,
    request_id: `22222222-2222-4222-8222-00000000000${id}`,
    title,
    fields: [field],
  }
  return entry
}
const first = question('1', 'First question', recommends)
const second = question('2', 'Second question', recommends)
const third = question('3', 'Third question', recommendsNothing)
const answered = (entry: InputRequestEntry): InputRequestEntry => ({
  ...entry,
  request: {
    ...entry.request,
    status: 'answered',
    answers: { route: 'merge' },
    ...firstAnswer,
    answered_by: 'user',
    by_person: true,
    resolved_at: '2026-10-24T12:00:00Z',
    revision: 2,
  },
})

/** The list as its host holds it: the drafts, and a question replaced by what its write said. */
function list(recommendAll = true) {
  const entries = [first, second, third]
  const wrapper: Wrapper = mount(RequestList, {
    props: {
      answered: [],
      drafts: {},
      entries,
      failed: false,
      loading: false,
      partial: false,
      recommendAll,
      result: requestList(entries),
      waiting: new Set(entries.map((entry) => requestIdentity(entry))),
      onDraft: (key: string, draft: RequestDraft) => {
        const { drafts } = wrapper.props() as { drafts: Record<string, RequestDraft> }
        void wrapper.setProps({ drafts: { ...drafts, [key]: draft } })
      },
    },
    attachTo: document.body,
    global: { plugins: [createI18n({ legacy: false, locale: 'en', messages })] },
  })
  wrappers.push(wrapper)
  return wrapper
}
const button = (wrapper: Wrapper, name: string) =>
  present(
    wrapper.findAll('button').find((control) => control.text() === name),
    `button ${name}`,
  )
async function press(wrapper: Wrapper, name: string) {
  await button(wrapper, name).trigger('click')
  await flushPromises()
}
const cardOf = (wrapper: Wrapper, title: string) =>
  present(
    wrapper.findAll('.request-card').find((card) => card.find('h3').text() === title),
    `card ${title}`,
  )

beforeEach(() => {
  vi.resetAllMocks()
})
afterEach(() => {
  for (const wrapper of wrappers.splice(0)) wrapper.unmount()
  document.body.replaceChildren()
})

describe('accepting what is recommended in all the blocks', () => {
  it('is not offered where the list is not told to offer it', () => {
    expect(list(false).text()).not.toContain('Accept recommended in all')
  })

  it('lists what would go and how many are left out, choosing and sending nothing', async () => {
    const wrapper = list()
    const toggle = button(wrapper, 'Accept recommended in all')
    expect(toggle.attributes('aria-expanded')).toBe('false')
    await press(wrapper, 'Accept recommended in all')
    expect(toggle.attributes('aria-expanded')).toBe('true')
    const items = wrapper.findAll('.request-recommended-item').map((item) => item.text())
    expect(items).toEqual([
      'TASK-7 · First questionRoute: Merge',
      'TASK-7 · Second questionRoute: Merge',
    ])
    expect(wrapper.get('.request-recommended-left').text()).toBe(
      'Not in the list: 1, with no recommendation that answers them.',
    )
    expect(button(wrapper, 'Accept 2').exists()).toBe(true)
    expect((wrapper.props() as { drafts: unknown }).drafts).toEqual({})
    expect(answerInputRequest).not.toHaveBeenCalled()
  })

  it('sends each listed block through its own record; what did not go stays filled with its reason', async () => {
    vi.mocked(answerInputRequest).mockImplementation(async (entry) => {
      if (entry.request.request_id === second.request.request_id)
        throw new InputRequestError('changed', 409)
      return answered(entry)
    })
    const wrapper = list()
    await press(wrapper, 'Accept recommended in all')
    const accept = button(wrapper, 'Accept 2')
    ;(accept.element as HTMLElement).focus()
    await press(wrapper, 'Accept 2')
    expect(
      vi
        .mocked(answerInputRequest)
        .mock.calls.map(([entry, values]) => [entry.request.title, values]),
    ).toEqual([
      ['First question', { route: 'merge' }],
      ['Second question', { route: 'merge' }],
    ])
    expect(cardOf(wrapper, 'First question').get('.request-state').text()).toContain('You answered')
    // What went folds: no form is left in it.
    expect(cardOf(wrapper, 'First question').findAll('input[type="radio"]')).toHaveLength(0)
    const failed = cardOf(wrapper, 'Second question')
    expect(failed.get('.request-foot [role="alert"]').text()).toBe(
      'This request changed or closed. Check its status; your draft is kept.',
    )
    expect(checkedLabels(failed)).toEqual(['Merge'])
    expect(checkedLabels(cardOf(wrapper, 'Third question'))).toEqual([])
    const result = wrapper.get('.request-recommended-result')
    expect(result.text()).toBe('Sent: 1 of 2. Not sent: 1; the reason is in each question.')
    expect(document.activeElement).toBe(result.element)
    expect(wrapper.find('.request-recommended-list').exists()).toBe(false)
  })

  it('says all went when they did', async () => {
    vi.mocked(answerInputRequest).mockImplementation(async (entry) => answered(entry))
    const wrapper = list()
    await press(wrapper, 'Accept recommended in all')
    await press(wrapper, 'Accept 2')
    expect(wrapper.get('.request-recommended-result').text()).toBe('Sent: 2 of 2.')
  })

  it('takes no second press while its writes are out', async () => {
    vi.mocked(answerInputRequest).mockReturnValue(new Promise(() => {}))
    const wrapper = list()
    await press(wrapper, 'Accept recommended in all')
    const accept = button(wrapper, 'Accept 2')
    ;(accept.element as HTMLElement).focus()
    await press(wrapper, 'Accept 2')
    // Filled, the questions recommend nothing more; what was sent stays listed under the press.
    expect(accept.attributes('aria-disabled')).toBe('true')
    expect(document.activeElement).toBe(accept.element)
    expect(wrapper.findAll('.request-recommended-item')).toHaveLength(2)
    await press(wrapper, 'Accept 2')
    expect(answerInputRequest).toHaveBeenCalledTimes(2)
  })
})
