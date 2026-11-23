/**
 * An answer that cancels open work its question did not ask about, of each kind whose answer can
 * (a goal's and a return's Don't do, a cancel's Cancel), in the list of everything waiting: the
 * server refuses it with the list of that work, the person confirms that list, and the retry
 * sends the refusal's token. A list that stood unchanged goes through on that one confirmation;
 * one that changed meanwhile is refused again and confirmed again by its own token. What a listed
 * row waits on stands as one piece, so its reference never splits at the hyphen.
 */
import { createI18n } from 'vue-i18n'

import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import RequestCancelList from '@/features/input-requests/components/RequestCancelList.vue'
import RequestList from '@/features/input-requests/components/RequestList.vue'
import { requestIdentity } from '@/features/input-requests/utils/requestIdentity.ts'
import type { RequestDraft } from '@/features/input-requests/utils/validateAnswers.ts'

import type { CancelList } from '@/shared/api/inputRequestAction.ts'
import { answerInputRequest, InputRequestError } from '@/shared/api/inputRequestApi.ts'
import type { InputRequestEntry } from '@/shared/api/inputRequestModel.ts'
import { validateInputRequestDetail } from '@/shared/api/inputRequestModel.ts'
import { messages } from '@/shared/i18n/index.ts'

import proposed from '../fixtures/server/request-proposed-goal.json'
import { firstAnswer, requestList } from '../support/inputRequests.ts'
import { present } from '../support/present.ts'

vi.mock('@/shared/api/inputRequestApi.ts', async (original) => ({
  ...(await original<typeof import('@/shared/api/inputRequestApi.ts')>()),
  answerInputRequest: vi.fn(),
}))

type Wrapper = VueWrapper
type Request = InputRequestEntry['request']
const wrappers: Wrapper[] = []

/** The token the goal's question was asked with, which no retry may send. */
const ASKED_TOKEN = 'dfb537979b8d6988'
/** What a refusal lists: the open work under the item, under the refusal's own token. */
const listed = (token: string, references: string[]): CancelList => ({
  cancels: references.map((reference) => ({
    reference,
    title: `Accepted work ${reference}`,
    kind: 'task',
    state: { key: 'dev', name: 'Dev', category: 'active' },
    container_state: null,
    holder: [],
  })),
  dependents: [],
  list_token: token,
})
const refusal = (list: CancelList) => new InputRequestError('cancel_list', 409, '', list)

/** The goal the server asks about, made into a question of each kind that cancels. */
function ofKind(kind: 'cancel' | 'goal' | 'return'): InputRequestEntry {
  const goal = validateInputRequestDetail(structuredClone(proposed))
  if (kind === 'goal') return goal
  const { fields } = goal.request
  const [answer, until, cancels] = fields
  if (!answer || !until || !cancels) throw new Error('the goal question lost a field')
  const changed: Partial<Request> =
    kind === 'return'
      ? { purpose: 'return', action: undefined }
      : {
          purpose: 'cancel',
          action: goal.request.action && { ...goal.request.action, point: 'cancel_shared' },
          fields: [
            {
              ...answer,
              options: [
                { id: 'cancel', label: 'Cancel it' },
                { id: 'keep', label: 'Keep it' },
              ],
            },
            { ...cancels, under: { field: 'answer', option: 'cancel' } },
          ],
        }
  return { ...goal, request: { ...goal.request, ...changed } }
}

/** Each kind with the answer that cancels, in the person's words, and the option it sends. */
const KINDS = [
  { kind: 'goal', word: 'Don’t do', option: 'drop' },
  { kind: 'return', word: 'Don’t do', option: 'drop' },
  { kind: 'cancel', word: 'Cancel', option: 'cancel' },
] as const

const answered = (entry: InputRequestEntry, answers: Request['answers']) => ({
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
/** The last button of that name: once its asking stands, the box beside it says it too. */
async function press(wrapper: Wrapper, name: string) {
  const buttons = wrapper.findAll('button').filter((button) => button.text() === name)
  await present(buttons.at(-1), `button ${name}`).trigger('click')
  await flushPromises()
}
const sent = () => vi.mocked(answerInputRequest).mock.calls.map(([, values]) => values)
const closes = (wrapper: Wrapper) =>
  wrapper.find('[data-cancel-list] [data-cancel-part="closes"]').text()

beforeEach(() => {
  vi.resetAllMocks()
})
afterEach(() => {
  for (const wrapper of wrappers.splice(0)) wrapper.unmount()
  document.body.replaceChildren()
})

describe.each(KINDS)('the $kind question’s $word over work it did not ask about', (one) => {
  it('confirms the refused list once, by the refusal’s token, and asks nothing again', async () => {
    const entry = ofKind(one.kind)
    vi.mocked(answerInputRequest)
      .mockRejectedValueOnce(refusal(listed('refused-token', ['MAIN-31'])))
      .mockResolvedValueOnce(answered(entry, { answer: one.option }))
    const wrapper = list(entry)
    // It asks first, then writes, and the refusal hands back its list.
    await press(wrapper, one.word)
    expect(answerInputRequest).not.toHaveBeenCalled()
    await press(wrapper, one.word)
    expect(sent()).toEqual([{ answer: one.option }])
    expect(closes(wrapper)).toBe('MAIN-31 Accepted work MAIN-31 · nobody holds it')
    expect(wrapper.text()).toContain(`«${one.word}» — are you sure?`)

    await press(wrapper, one.word)
    expect(sent()).toEqual([
      { answer: one.option },
      { answer: one.option, cancels: 'refused-token' },
    ])
    expect(sent().map((values) => values.cancels)).not.toContain(ASKED_TOKEN)
    // The list stood unchanged, so the confirmed retry went through: no list, no asking.
    expect(wrapper.find('[data-cancel-list]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('are you sure?')
    expect(wrapper.find('.request-state').text()).toContain('You answered')
  })

  it('asks again over a list that changed meanwhile, and confirms it by its own token', async () => {
    const entry = ofKind(one.kind)
    vi.mocked(answerInputRequest)
      .mockRejectedValueOnce(refusal(listed('first-token', ['MAIN-31'])))
      .mockRejectedValueOnce(refusal(listed('second-token', ['MAIN-31', 'MAIN-32'])))
      .mockResolvedValueOnce(answered(entry, { answer: one.option }))
    const wrapper = list(entry)
    await press(wrapper, one.word)
    await press(wrapper, one.word)
    await press(wrapper, one.word)
    expect(closes(wrapper)).toContain('MAIN-32')
    expect(wrapper.text()).toContain(`«${one.word}» — are you sure?`)

    await press(wrapper, one.word)
    expect(sent().map((values) => values.cancels)).toEqual([
      undefined,
      'first-token',
      'second-token',
    ])
    expect(wrapper.find('[data-cancel-list]').exists()).toBe(false)
  })
})

describe('a row of the list that waits on work the answer cancels', () => {
  it('says what it waits on as one piece, its reference whole', () => {
    const wrapper = mount(RequestCancelList, {
      props: {
        list: {
          ...listed('token', ['MAIN-314']),
          dependents: [
            {
              reference: 'MAIN-315',
              title: 'Release notes',
              kind: 'task',
              waits_on: 'MAIN-314',
              how: 'blocks',
            },
          ],
        },
      },
      global: { plugins: [createI18n({ legacy: false, locale: 'ru', messages })] },
    })
    wrappers.push(wrapper)
    const row = wrapper.get('[data-cancel-part="waiting"]').get('li')
    expect(row.text().replaceAll(/\s+/gu, ' ')).toBe('MAIN-315 Release notes · ждёт MAIN-314')
    expect(row.get('[data-cancel-waits]').text()).toBe('ждёт MAIN-314')
  })
})
