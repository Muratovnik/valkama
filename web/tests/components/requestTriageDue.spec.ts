/**
 * The line «time to triage» in «Needs my answer»: one per space the read says is due, with how
 * many of its stack's cards wait unmarked and how long the oldest has waited; none when the read
 * says none is due; over «All» and the triage tab, not over another kind's; and no question,
 * so it holds nothing to answer and focus does not go to it after an answer.
 */
import { createI18n } from 'vue-i18n'

import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import InputRequestsHub from '@/features/input-requests/components/InputRequestsHub.vue'
import { requestListView } from '@/features/input-requests/utils/requestListView.ts'

import { answerInputRequest, fetchInputRequests } from '@/shared/api/inputRequestApi.ts'
import type { InputRequestList } from '@/shared/api/inputRequestModel.ts'
import { validateInputRequestDetail } from '@/shared/api/inputRequestModel.ts'
import { messages } from '@/shared/i18n/index.ts'

import group from '../fixtures/server/request-triage-group.json'
import { answered, requestEntry, requestList } from '../support/inputRequests.ts'
import { present } from '../support/present.ts'
import { answer } from '../support/radioAnswers.ts'
import { residentView } from '../support/residentView.ts'

vi.mock('@/shared/api/inputRequestApi.ts', async (original) => ({
  ...(await original<typeof import('@/shared/api/inputRequestApi.ts')>()),
  answerInputRequest: vi.fn(),
  fetchInputRequests: vi.fn(),
}))

const NOW = Date.parse('2026-11-19T12:00:00Z')
const NBSP = '\u{A0}'
/** Past MAIN's count, its oldest card three days and four hours in the stack. */
const MAIN = {
  space: { key: 'MAIN', name: 'Main' },
  count: 120,
  oldest_at: '2026-11-16T08:00:00Z',
}
/** Past ALPHA's age alone, its oldest card two hours and five minutes in the stack. */
const ALPHA = {
  space: { key: 'ALPHA', name: 'Alpha' },
  count: 1,
  oldest_at: '2026-11-19T09:55:00Z',
}
const wrappers: VueWrapper[] = []
residentView(requestListView)

function hub(list: InputRequestList, locale: 'en' | 'ru' = 'en') {
  vi.mocked(fetchInputRequests).mockResolvedValue(list)
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
const lines = (wrapper: VueWrapper) =>
  wrapper
    .findAll('[data-triage-due]')
    .map((line) => [line.attributes('data-triage-due'), line.text()])

beforeEach(() => {
  vi.useFakeTimers({ now: NOW })
  vi.resetAllMocks()
})
afterEach(async () => {
  for (const wrapper of wrappers.splice(0)) wrapper.unmount()
  await flushPromises()
  vi.useRealTimers()
  document.body.replaceChildren()
})

describe('the line «time to triage»', () => {
  it('stands for each due space with how many wait unmarked and how long the oldest has', async () => {
    const wrapper = hub({ ...requestList(), triage_due: [MAIN, ALPHA] })
    await flushPromises()
    expect(lines(wrapper)).toEqual([
      [
        'MAIN',
        `Time to triage · Main: 120 awaiting triage, the oldest for 3${NBSP}d${NBSP}4${NBSP}h`,
      ],
      [
        'ALPHA',
        `Time to triage · Alpha: 1 awaiting triage, the oldest for 2${NBSP}h${NBSP}5${NBSP}min`,
      ],
    ])
  })

  it('says it in Russian as well', async () => {
    const wrapper = hub({ ...requestList(), triage_due: [MAIN] }, 'ru')
    await flushPromises()
    expect(lines(wrapper)).toEqual([
      [
        'MAIN',
        `Пора разобрать · Main: ждут разбора 120, старшая${NBSP}— 3${NBSP}дн.${NBSP}4${NBSP}ч`,
      ],
    ])
  })

  it('stands nowhere when the read names no due space', async () => {
    const wrapper = hub(requestList())
    await flushPromises()
    // The question the read holds is drawn, so the line's absence is not an empty window's.
    expect(wrapper.findAll('[data-request-waiting]')).toHaveLength(1)
    expect(lines(wrapper)).toEqual([])
  })

  it('stands over «All» and the triage tab, and not over another kind', async () => {
    const triage = validateInputRequestDetail(structuredClone(group))
    const wrapper = hub({ ...requestList([requestEntry(), triage]), triage_due: [MAIN] })
    await flushPromises()
    const tab = (name: string) =>
      present(
        wrapper.findAll('[role="tab"]').find((one) => one.text().startsWith(name)),
        `tab ${name}`,
      )
    expect(lines(wrapper).map(([key]) => key)).toEqual(['MAIN'])
    await tab('Choice').trigger('click')
    expect(lines(wrapper)).toEqual([])
    await tab('Triage').trigger('click')
    expect(lines(wrapper).map(([key]) => key)).toEqual(['MAIN'])
  })

  it('takes no answer, and focus does not go to it after the last question is answered', async () => {
    const entry = requestEntry()
    const wrapper = hub({ ...requestList([entry]), triage_due: [MAIN] })
    await flushPromises()
    const line = wrapper.get('[data-triage-due]')
    expect(line.findAll('button, a, input, [tabindex]')).toHaveLength(0)
    expect(line.attributes('data-request-waiting')).toBeUndefined()

    vi.mocked(answerInputRequest).mockResolvedValueOnce(answered(entry))
    vi.mocked(fetchInputRequests).mockResolvedValue({ ...requestList([]), triage_due: [MAIN] })
    await answer(wrapper, 'Yes')
    await present(
      wrapper.findAll('button').find((one) => one.text() === 'Send'),
      'Send',
    ).trigger('click')
    await flushPromises()
    // Focus stays on the question just answered, as it does with no line beside it.
    const card = wrapper.get('.request-card')
    expect(card.get('.request-state').text()).toMatch(/^You answered/u)
    expect(document.activeElement).toBe(card.element)
    expect(line.element.contains(document.activeElement)).toBe(false)
  })
})
