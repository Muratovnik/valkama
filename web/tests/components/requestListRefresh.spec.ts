/**
 * Answering in «Needs my answer» while its list is read again: an answer and a read that cross
 * leave every question once, the answered one answered where it stood and waiting nowhere, what
 * is still out as the person filled it, and what the read brought new in the list.
 */
import { createI18n } from 'vue-i18n'

import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import InputRequestsHub from '@/features/input-requests/components/InputRequestsHub.vue'
import { requestListView } from '@/features/input-requests/utils/requestListView.ts'

import {
  answerInputRequest,
  fetchInputRequest,
  fetchInputRequests,
} from '@/shared/api/inputRequestApi.ts'
import type {
  InputRequestEntry,
  InputRequestField,
  InputRequestList,
} from '@/shared/api/inputRequestModel.ts'
import { messages } from '@/shared/i18n/index.ts'

import { firstAnswer, requestEntry, requestList } from '../support/inputRequests.ts'
import { present } from '../support/present.ts'
import { checkedLabels } from '../support/radioAnswers.ts'
import { residentView } from '../support/residentView.ts'

vi.mock('@/shared/api/inputRequestApi.ts', async (original) => ({
  ...(await original<typeof import('@/shared/api/inputRequestApi.ts')>()),
  answerInputRequest: vi.fn(),
  fetchInputRequest: vi.fn(),
  fetchInputRequests: vi.fn(),
}))

const POLL = 30_000
const wrappers: VueWrapper[] = []

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
function question(id: number, title: string): InputRequestEntry {
  const entry = requestEntry()
  entry.request = {
    ...entry.request,
    request_id: `22222222-2222-4222-8222-00000000000${id}`,
    title,
    created_at: `2026-10-24T10:0${id}:00Z`,
    fields: [recommends],
  }
  return entry
}
/** Newest first, as the server lists them. */
const first = question(3, 'First question')
const second = question(2, 'Second question')
const asked = question(4, 'Asked meanwhile')
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
    revision: entry.request.revision + 1,
  },
})

/** A promise the test settles. */
function held<T>() {
  const settled: { now?: (value: T) => void } = {}
  const promise = new Promise<T>((resolve) => (settled.now = resolve))
  return { promise, settle: (value: T) => settled.now?.(value) }
}

function hub() {
  const wrapper = mount(InputRequestsHub, {
    props: { open: true },
    attachTo: document.body,
    global: {
      plugins: [createI18n({ legacy: false, locale: 'en', messages })],
      stubs: { teleport: true },
    },
  })
  wrappers.push(wrapper)
  return wrapper
}
const titles = (wrapper: VueWrapper) =>
  wrapper.findAll('.request-card h3').map((heading) => heading.text())
const cardOf = (wrapper: VueWrapper, title: string) =>
  present(
    wrapper.findAll('.request-card').find((card) => card.get('h3').text() === title),
    `card ${title}`,
  )
async function press(wrapper: VueWrapper, name: string) {
  const button = present(
    wrapper.findAll('button').find((control) => control.text() === name),
    `button ${name}`,
  )
  await button.trigger('click')
  await flushPromises()
}

residentView(requestListView)

beforeEach(() => {
  vi.useFakeTimers()
  vi.resetAllMocks()
  vi.mocked(fetchInputRequest).mockImplementation(async (_target, id) =>
    present(
      [first, second, asked].find((entry) => entry.request.request_id === id),
      'question',
    ),
  )
})
afterEach(async () => {
  for (const wrapper of wrappers.splice(0)) wrapper.unmount()
  await flushPromises()
  vi.useRealTimers()
  document.body.replaceChildren()
})

describe('answering while the list is read again', () => {
  it('takes a read that lands while the answers are out, and loses neither', async () => {
    vi.mocked(fetchInputRequests).mockResolvedValueOnce(requestList([first, second]))
    const writes = [held<InputRequestEntry>(), held<InputRequestEntry>()]
    vi.mocked(answerInputRequest)
      .mockReturnValueOnce(present(writes[0], 'first write').promise)
      .mockReturnValueOnce(present(writes[1], 'second write').promise)
    const wrapper = hub()
    await flushPromises()
    await press(wrapper, 'Accept recommended in all')
    await press(wrapper, 'Accept 2')
    expect(answerInputRequest).toHaveBeenCalledTimes(2)

    // The poll reads the list while both answers are out: the server still lists both, at the
    // revision they were asked at, and a question asked meanwhile.
    vi.mocked(fetchInputRequests).mockResolvedValueOnce(requestList([asked, first, second]))
    await vi.advanceTimersByTimeAsync(POLL)
    await flushPromises()
    expect(titles(wrapper)).toEqual(['Asked meanwhile', 'First question', 'Second question'])
    // What is out stays as it was filled.
    expect(checkedLabels(cardOf(wrapper, 'First question'))).toEqual(['Merge'])
    expect(checkedLabels(cardOf(wrapper, 'Second question'))).toEqual(['Merge'])

    // The answers land; the reads after them no longer list what they answered.
    vi.mocked(fetchInputRequests).mockResolvedValue(requestList([asked]))
    present(writes[0], 'first write').settle(answered(first))
    present(writes[1], 'second write').settle(answered(second))
    await flushPromises()
    expect(titles(wrapper)).toEqual(['Asked meanwhile', 'First question', 'Second question'])
    for (const title of ['First question', 'Second question'])
      expect(cardOf(wrapper, title).get('.request-state').text()).toContain('You answered')
    expect(wrapper.get('.request-status').text()).toBe('Waiting for an answer: 1')
    expect(wrapper.get('.request-recommended-result').text()).toBe('Sent: 2 of 2.')
  })

  it('believes no read that began before an answer landed', async () => {
    vi.mocked(fetchInputRequests).mockResolvedValueOnce(requestList([first, second]))
    const wrapper = hub()
    await flushPromises()
    // The poll's read hangs; it was begun before the answer and still lists the question.
    const stale = held<InputRequestList>()
    vi.mocked(fetchInputRequests).mockReturnValueOnce(stale.promise)
    await vi.advanceTimersByTimeAsync(POLL)
    const signal = present(vi.mocked(fetchInputRequests).mock.calls[1], 'poll')[0]?.signal

    vi.mocked(answerInputRequest).mockResolvedValueOnce(answered(first))
    vi.mocked(fetchInputRequests).mockResolvedValue(requestList([second]))
    const card = cardOf(wrapper, 'First question')
    await card.get('input[value="merge"]').setValue(true)
    await press(wrapper, 'Send')
    expect(signal?.aborted).toBe(true)
    stale.settle(requestList([first, second]))
    await flushPromises()

    expect(titles(wrapper)).toEqual(['First question', 'Second question'])
    expect(cardOf(wrapper, 'First question').get('.request-state').text()).toContain('You answered')
    expect(wrapper.get('.request-status').text()).toBe('Waiting for an answer: 1')
  })
})
