/**
 * A group of findings in the list of everything waiting, on the question the server asks it
 * with: its findings stand ticked, an unticked one leaves the group's answer and Do says how many
 * go, with none ticked Do and Later… are unavailable with the reason under them, and Don't do over
 * open work the question did not ask about confirms the list the server's refusal hands back, by
 * that refusal's token and never by the one the question was asked with.
 */
import { createI18n } from 'vue-i18n'

import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import RequestList from '@/features/input-requests/components/RequestList.vue'
import { requestIdentity } from '@/features/input-requests/utils/requestIdentity.ts'
import type { RequestDraft } from '@/features/input-requests/utils/validateAnswers.ts'

import type { CancelList } from '@/shared/api/inputRequestAction.ts'
import { answerInputRequest, InputRequestError } from '@/shared/api/inputRequestApi.ts'
import type { InputRequestEntry } from '@/shared/api/inputRequestModel.ts'
import { validateInputRequestDetail } from '@/shared/api/inputRequestModel.ts'
import { messages } from '@/shared/i18n/index.ts'

import asked from '../fixtures/server/request-triage-group.json'
import { firstAnswer, requestList } from '../support/inputRequests.ts'
import { present } from '../support/present.ts'

vi.mock('@/shared/api/inputRequestApi.ts', async (original) => ({
  ...(await original<typeof import('@/shared/api/inputRequestApi.ts')>()),
  answerInputRequest: vi.fn(),
}))

type Wrapper = VueWrapper
const wrappers: Wrapper[] = []
/** The token of the list the question was asked with, which lists every task of the group. */
const ASKED_TOKEN = 'de58e5f2ca845941'
/** What the refusal of the drop lists: the open work the question did not ask about. */
const REFUSED: CancelList = {
  cancels: [
    {
      reference: 'MAIN-31',
      title: 'Accepted work under the goal',
      kind: 'task',
      state: { key: 'dev', name: 'Dev', category: 'active' },
      container_state: null,
      holder: ['codex (session 71aa0000)'],
    },
  ],
  dependents: [],
  list_token: 'refused-token',
}

function group(change: Partial<InputRequestEntry['target']> = {}): InputRequestEntry {
  const entry = validateInputRequestDetail(structuredClone(asked))
  return { ...entry, target: { ...entry.target, ...change } }
}
const answered = (entry: InputRequestEntry, answers: InputRequestEntry['request']['answers']) => ({
  ...entry,
  request: {
    ...entry.request,
    status: 'answered' as const,
    answers,
    ...firstAnswer,
    answered_by: 'user',
    by_person: true,
    resolved_at: '2026-10-24T12:00:00Z',
    revision: 1,
  },
})

/** The list as its host holds it: the drafts the list hands back, and nothing else. */
function list(entry: InputRequestEntry) {
  const wrapper: Wrapper = mount(RequestList, {
    props: {
      answered: [],
      drafts: {},
      entries: [entry],
      failed: false,
      loading: false,
      partial: false,
      result: requestList([entry]),
      waiting: new Set([requestIdentity(entry)]),
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
const boxes = (wrapper: Wrapper) =>
  wrapper.get('[data-findings]').findAll<HTMLInputElement>('input[type="checkbox"]')
const answers = (wrapper: Wrapper) =>
  wrapper
    .get('.request-foot')
    .findAll('button')
    .map((button) => button.text())
async function press(wrapper: Wrapper, name: string) {
  const buttons = wrapper.findAll('button').filter((button) => button.text() === name)
  await present(buttons.at(-1), `button ${name}`).trigger('click')
  await flushPromises()
}
const sent = () => vi.mocked(answerInputRequest).mock.calls.map(([, values]) => values)
/** The foot's button that says this now. */
const button = (wrapper: Wrapper, name: string) =>
  present(
    wrapper
      .get('.request-foot')
      .findAll('button')
      .find((one) => one.text() === name),
    `button ${name}`,
  )
async function untickAll(wrapper: Wrapper) {
  for (const box of boxes(wrapper)) await box.setValue(false)
}
const UNTICKED = 'Tick a finding first, or answer «Don’t do».'

beforeEach(() => {
  vi.resetAllMocks()
})
afterEach(() => {
  for (const wrapper of wrappers.splice(0)) wrapper.unmount()
  document.body.replaceChildren()
})

describe('a group of findings', () => {
  it('shows the proposed goal with its conditions and every finding ticked', () => {
    const wrapper = list(group())
    expect(wrapper.get('[data-kind-part="conditions"]').text()).toContain(
      'The export writes every field',
    )
    expect(boxes(wrapper).map((box) => [box.element.value, box.element.checked])).toEqual([
      ['main-28', true],
      ['main-29', true],
    ])
    expect(answers(wrapper)).toEqual(expect.arrayContaining(['Do', 'Later…', 'Don’t do']))
  })

  it('names how many go on Do once one is unticked, and sends only the ticked ones', async () => {
    const entry = group()
    vi.mocked(answerInputRequest).mockResolvedValue(answered(entry, { answer: 'do' }))
    const wrapper = list(entry)
    await present(boxes(wrapper)[1], 'the second finding').setValue(false)
    expect(answers(wrapper)).toContain('Do: 1')
    expect(answers(wrapper)).not.toContain('Do')
    expect(answerInputRequest).not.toHaveBeenCalled()

    await press(wrapper, 'Do: 1')
    expect(sent()).toEqual([{ answer: 'do', items: ['main-28'] }])
  })

  it('with no finding ticked offers Do and Later… unavailable, the reason under them', async () => {
    const wrapper = list(group())
    await untickAll(wrapper)
    const reason = wrapper.get('.request-blocked')
    expect(reason.text()).toBe(UNTICKED)
    for (const name of ['Do: 0', 'Later…']) {
      expect(button(wrapper, name).attributes()).toHaveProperty('disabled')
      expect(button(wrapper, name).attributes('aria-describedby')).toBe(reason.attributes('id'))
    }
    expect(button(wrapper, 'Don’t do').attributes()).not.toHaveProperty('disabled')
    expect(answerInputRequest).not.toHaveBeenCalled()

    // One ticked again gives both back, and the reason goes.
    await present(boxes(wrapper)[0], 'the first finding').setValue(true)
    expect(wrapper.find('.request-blocked').exists()).toBe(false)
    expect(button(wrapper, 'Do: 1').attributes()).not.toHaveProperty('disabled')
    expect(button(wrapper, 'Later…').attributes()).not.toHaveProperty('disabled')
  })

  it('holds the room of the reason under the answers while the question waits, ticked or not', async () => {
    const wrapper = list(group())
    const room = () => wrapper.get('.request-blocked-place').attributes('data-room')
    expect(room()).toBe(UNTICKED)
    expect(wrapper.find('.request-blocked').exists()).toBe(false)
    await untickAll(wrapper)
    expect(room()).toBe(UNTICKED)
    expect(wrapper.get('.request-blocked').text()).toBe(UNTICKED)
  })

  it('keeps Put off unavailable for the same reason once nothing is ticked, said once', async () => {
    const wrapper = list(group())
    await press(wrapper, 'Later…')
    await wrapper.get('input[type="date"]').setValue('2099-03-01')
    expect(button(wrapper, 'Put off').attributes()).not.toHaveProperty('disabled')
    await untickAll(wrapper)
    expect(button(wrapper, 'Put off').attributes()).toHaveProperty('disabled')
    const reason = wrapper.get('.until-reason')
    expect(reason.text()).toBe(UNTICKED)
    // Said under Put off alone: the line under the answers keeps only its room.
    expect(wrapper.find('.request-blocked').exists()).toBe(false)
    for (const name of ['Put off', 'Do: 0'])
      expect(button(wrapper, name).attributes('aria-describedby')).toBe(reason.attributes('id'))
    expect(answerInputRequest).not.toHaveBeenCalled()
  })

  it('drops the whole group with nothing ticked, its asking confirmed in the box beside it', async () => {
    const entry = group()
    vi.mocked(answerInputRequest).mockResolvedValue(answered(entry, { answer: 'drop' }))
    const wrapper = list(entry)
    await untickAll(wrapper)
    await press(wrapper, 'Don’t do')
    expect(answerInputRequest).not.toHaveBeenCalled()
    // Later… is blocked, but the box it lends to the asking says Don't do and takes the press.
    expect(button(wrapper, 'Don’t do').attributes()).not.toHaveProperty('disabled')
    await press(wrapper, 'Don’t do')
    // Nothing ticked goes as no ticks at all, which the server reads as none kept.
    expect(sent()).toEqual([{ answer: 'drop' }])
  })

  it('takes nothing ticked where the question cannot be written', () => {
    const wrapper = list(group({ writable: false }))
    expect(boxes(wrapper).map((box) => box.element.disabled)).toEqual([true, true])
  })

  it('confirms by the refusal’s token the open work a drop would cancel, never the question’s', async () => {
    const entry = group()
    expect(entry.request.action?.cancel_list?.list_token).toBe(ASKED_TOKEN)
    vi.mocked(answerInputRequest)
      .mockRejectedValueOnce(new InputRequestError('cancel_list', 409, '', REFUSED))
      .mockResolvedValueOnce(answered(entry, { answer: 'drop' }))
    const wrapper = list(entry)
    await press(wrapper, 'Don’t do')
    expect(answerInputRequest).not.toHaveBeenCalled()
    await press(wrapper, 'Don’t do')
    expect(sent()).toEqual([{ answer: 'drop', items: ['main-28', 'main-29'] }])

    // The refusal's list stands, and the answer asks again before it confirms it.
    const listed = wrapper.get('[data-cancel-list]')
    expect(listed.get('[data-cancel-part="closes"]').text()).toBe(
      'MAIN-31 Accepted work under the goal · codex · 71aa0000',
    )
    expect(document.activeElement).toBe(listed.get('[role="alert"]').element)
    expect(wrapper.text()).toContain('«Don’t do» — are you sure?')

    await press(wrapper, 'Don’t do')
    expect(sent()).toEqual([
      { answer: 'drop', items: ['main-28', 'main-29'] },
      { answer: 'drop', items: ['main-28', 'main-29'], cancels: 'refused-token' },
    ])
    expect(sent().map((values) => values.cancels)).not.toContain(ASKED_TOKEN)
    expect(wrapper.find('[data-cancel-list]').exists()).toBe(false)
  })
})
