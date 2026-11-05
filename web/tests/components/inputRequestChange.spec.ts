/**
 * Changing an answer in the widget: when it is offered, the form it opens, every way back
 * out of it and what a refusal keeps. The real keyboard is `production-question-answer.spec.ts`.
 */
import { createI18n } from 'vue-i18n'

import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import InputRequestsHub from '@/features/input-requests/components/InputRequestsHub.vue'
import RequestCard from '@/features/input-requests/components/RequestCard.vue'
import { draftFromAnswer } from '@/features/input-requests/utils/answerChange.ts'
import { EMPTY_DRAFT } from '@/features/input-requests/utils/validateAnswers.ts'

import {
  changeInputRequestAnswer,
  fetchInputRequest,
  fetchInputRequests,
  InputRequestError,
} from '@/shared/api/inputRequestApi.ts'
import type { InputRequestEntry, InputRequestField } from '@/shared/api/inputRequestModel.ts'
import { messages } from '@/shared/i18n/index.ts'

import {
  answered,
  firstAnswer,
  requestEntry,
  requestList,
  twoQuestions,
} from '../support/inputRequests.ts'
import { present } from '../support/present.ts'
import { answer, checkedLabels, radios } from '../support/radioAnswers.ts'

vi.mock('@/shared/api/inputRequestApi.ts', async (original) => ({
  ...(await original<typeof import('@/shared/api/inputRequestApi.ts')>()),
  changeInputRequestAnswer: vi.fn(),
  fetchInputRequest: vi.fn(),
  fetchInputRequests: vi.fn(),
}))

const route: InputRequestField = {
  id: 'route',
  label: 'Route',
  type: 'choice',
  required: true,
  options: [
    { id: 'keep', label: 'Keep' },
    { id: 'merge', label: 'Merge' },
  ],
}

function given(change: Partial<InputRequestEntry['request']>): InputRequestEntry {
  const entry = requestEntry()
  entry.request = {
    ...entry.request,
    fields: [route],
    status: 'answered',
    answers: {},
    ...firstAnswer,
    answered_by: 'user',
    by_person: true,
    resolved_at: '2026-10-24T12:00:00Z',
    revision: 2,
    ...change,
  }
  return entry
}
const entry = () =>
  given({ answers: { route: 'keep' }, field_notes: { route: 'Why' }, note: 'Whole' })

type Wrapper = VueWrapper
const wrappers: Wrapper[] = []
function card(subject: InputRequestEntry, props: Record<string, unknown> = {}) {
  const wrapper: Wrapper = mount(RequestCard, {
    props: {
      'entry': subject,
      'draft': EMPTY_DRAFT,
      'onUpdate:draft': (draft: unknown) => {
        void wrapper.setProps({ draft })
      },
      ...props,
    },
    attachTo: document.body,
    global: { plugins: [createI18n({ legacy: false, locale: 'en', messages })] },
  })
  wrappers.push(wrapper)
  return wrapper
}
const buttonNamed = (wrapper: Wrapper, name: string) =>
  present(
    wrapper
      .findAll('button')
      .find((control) => control.text() === name || control.attributes('aria-label') === name),
    name,
  )
const offered = (wrapper: Wrapper) => wrapper.find('[aria-label="Change answer"]').exists()
const press = async (wrapper: Wrapper, name: string) => {
  await buttonNamed(wrapper, name).trigger('click')
  await flushPromises()
}
const textareaNamed = (wrapper: Wrapper, name: string) =>
  present(
    wrapper.findAll('textarea').find((area) => area.attributes('aria-label') === name),
    name,
  )

beforeEach(() => {
  vi.resetAllMocks()
})
afterEach(() => {
  for (const wrapper of wrappers.splice(0)) wrapper.unmount()
  document.body.replaceChildren()
})

describe('changing an answer', () => {
  it('offers it only while the source can write and the task is open', () => {
    expect(offered(card(entry()))).toBe(true)
    const readOnly = entry()
    readOnly.target.writable = false
    expect(offered(card(readOnly))).toBe(false)
    const closed = card(entry(), { itemClosed: true })
    expect(offered(closed)).toBe(false)
    expect(closed.text()).toContain('Reopen the task to change this answer.')
    const full = entry()
    full.request.answer_version = 50
    full.request.history = Array.from({ length: 49 }, (_, index) => ({
      version: index + 1,
      answers: {},
      own: {},
      field_notes: {},
      note: null,
      answered_by: 'user',
      by_person: true,
      answered_at: '2026-10-24T11:00:00Z',
    }))
    const atLimit = card(full)
    expect(offered(atLimit)).toBe(false)
    expect(atLimit.text()).toContain('cannot be changed again')
    const declined = requestEntry()
    declined.request.status = 'declined'
    expect(offered(card(declined))).toBe(false)
  })

  it('opens the same form on the answer in force, with Save off until it differs', async () => {
    const wrapper = card(entry())
    await press(wrapper, 'Change answer')
    expect(checkedLabels(wrapper)).toEqual(['Keep'])
    expect(
      (textareaNamed(wrapper, 'Comment on this field: Route').element as HTMLTextAreaElement).value,
    ).toBe('Why')
    expect(
      (textareaNamed(wrapper, 'Comment on the question').element as HTMLTextAreaElement).value,
    ).toBe('Whole')
    expect(wrapper.text()).not.toContain('Send')
    const save = buttonNamed(wrapper, 'Save change')
    expect(save.attributes('disabled')).toBeDefined()
    await answer(wrapper, 'Merge')
    expect(buttonNamed(wrapper, 'Save change').attributes('disabled')).toBeUndefined()
    await answer(wrapper, 'Keep')
    expect(buttonNamed(wrapper, 'Save change').attributes('disabled')).toBeDefined()
  })

  it('saves the change against the revision it opened on and folds on the new answer', async () => {
    const start = entry()
    const after = given({
      answers: { route: 'merge' },
      answer_version: 2,
      revision: 3,
      resolved_at: '2026-10-25T12:00:00Z',
      history: [
        {
          version: 1,
          answers: { route: 'keep' },
          own: {},
          field_notes: { route: 'Why' },
          note: 'Whole',
          answered_by: 'user',
          by_person: true,
          answered_at: '2026-10-24T12:00:00Z',
        },
      ],
    })
    vi.mocked(changeInputRequestAnswer).mockResolvedValue(after)
    const wrapper = card(start)
    await press(wrapper, 'Change answer')
    await answer(wrapper, 'Merge')
    await press(wrapper, 'Save change')
    expect(changeInputRequestAnswer).toHaveBeenCalledExactlyOnceWith(
      { ...start, request: { ...start.request, revision: 2 } },
      { route: 'merge' },
      { own: {}, field_notes: { route: 'Why' }, note: 'Whole' },
    )
    await flushPromises()
    expect(wrapper.find('input').exists()).toBe(false)
    expect(wrapper.get('.request-state').text()).toMatch(/changed ·/u)
    expect(document.activeElement).toBe(wrapper.get('.request-card').element)
    expect(wrapper.emitted('update:draft')?.at(-1)).toEqual([EMPTY_DRAFT])
    // What was replaced is behind its press, and says who said it and what.
    expect(wrapper.text()).not.toContain('Keep, ')
    const toggle = buttonNamed(wrapper, 'Previous answers (1)')
    expect(toggle.attributes('aria-expanded')).toBe('false')
    await press(wrapper, 'Previous answers (1)')
    const version = wrapper.get('.request-history-version')
    expect(version.text()).toContain('You')
    expect(version.text()).toContain('Route: Keep; comment: Why')
    expect(version.text()).toContain('Whole')
  })

  it('cancels at once with nothing changed, and focus goes back to the way in', async () => {
    const wrapper = card(entry())
    await press(wrapper, 'Change answer')
    await press(wrapper, 'Cancel')
    expect(wrapper.find('input').exists()).toBe(false)
    expect(wrapper.find('.confirm-strip').exists()).toBe(false)
    expect(wrapper.emitted('update:draft')?.at(-1)).toEqual([EMPTY_DRAFT])
    expect(document.activeElement).toBe(buttonNamed(wrapper, 'Change answer').element)
  })

  it('asks before discarding a change, with focus on going on, and going on keeps it', async () => {
    const wrapper = card(entry())
    await press(wrapper, 'Change answer')
    await answer(wrapper, 'Merge')
    await press(wrapper, 'Cancel')
    expect(wrapper.get('.confirm-strip').text()).toContain('Discard the change to this answer?')
    const going = wrapper.get('.confirm-cancel')
    expect(going.text()).toBe('Continue')
    expect(document.activeElement).toBe(going.element)
    await going.trigger('click')
    await flushPromises()
    expect(wrapper.find('.confirm-strip').exists()).toBe(false)
    expect(checkedLabels(wrapper)).toEqual(['Merge'])
    await press(wrapper, 'Cancel')
    await wrapper.get('.confirm-go').trigger('click')
    await flushPromises()
    expect(wrapper.find('input').exists()).toBe(false)
    expect(wrapper.emitted('update:draft')?.at(-1)).toEqual([EMPTY_DRAFT])
    expect(wrapper.get('.request-option.is-chosen').text()).toContain('Keep')
  })

  it('takes Escape from inside the form as Cancel, leaving the surface around it open', async () => {
    const wrapper = card(entry())
    await press(wrapper, 'Change answer')
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    const outside = vi.fn()
    document.body.addEventListener('keydown', outside)
    present(radios(wrapper)[0], 'radio').element.dispatchEvent(escape)
    await flushPromises()
    document.body.removeEventListener('keydown', outside)
    expect(outside).not.toHaveBeenCalled()
    expect(wrapper.find('input').exists()).toBe(false)
  })

  it('reads a conflict as it does for an answer: the draft stays, and Check status moves on', async () => {
    const start = entry()
    vi.mocked(changeInputRequestAnswer).mockRejectedValue(
      new InputRequestError('revision_conflict', 409),
    )
    const newer = given({
      answers: { route: 'keep' },
      note: 'From elsewhere',
      revision: 5,
    })
    vi.mocked(fetchInputRequest).mockResolvedValue(newer)
    const wrapper = card(start)
    await press(wrapper, 'Change answer')
    await answer(wrapper, 'Merge')
    await press(wrapper, 'Save change')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('your draft is kept')
    expect(checkedLabels(wrapper)).toEqual(['Merge'])
    expect(buttonNamed(wrapper, 'Save change').attributes('disabled')).toBeDefined()
    await press(wrapper, 'Check status')
    await flushPromises()
    expect(checkedLabels(wrapper)).toEqual(['Merge'])
    expect(buttonNamed(wrapper, 'Save change').attributes('disabled')).toBeUndefined()
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    vi.mocked(changeInputRequestAnswer).mockResolvedValue(newer)
    await press(wrapper, 'Save change')
    expect(vi.mocked(changeInputRequestAnswer).mock.lastCall?.[0].request.revision).toBe(5)
  })

  it('does not overwrite an answer that moved on under the form, and a poll keeps the refusal', async () => {
    const start = entry()
    vi.mocked(changeInputRequestAnswer).mockRejectedValue(
      new InputRequestError('revision_conflict', 409),
    )
    const wrapper = card(start)
    await press(wrapper, 'Change answer')
    await answer(wrapper, 'Merge')
    const moved = given({ answers: { route: 'keep' }, note: 'Moved', revision: 7 })
    await wrapper.setProps({ entry: moved })
    await press(wrapper, 'Save change')
    await flushPromises()
    // Written against what the form opened on, so the server can refuse it.
    expect(vi.mocked(changeInputRequestAnswer).mock.lastCall?.[0].request.revision).toBe(2)
    expect(wrapper.find('[role="alert"]').exists()).toBe(true)
    await wrapper.setProps({ entry: structuredClone(moved) })
    await flushPromises()
    expect(wrapper.find('[role="alert"]').exists()).toBe(true)
    expect(buttonNamed(wrapper, 'Save change').attributes('disabled')).toBeDefined()
  })

  it('says a closed task in its own words, not as a conflict', async () => {
    vi.mocked(changeInputRequestAnswer).mockRejectedValue(
      new InputRequestError('workflow_guard', 409, 'task_closed'),
    )
    const wrapper = card(entry())
    await press(wrapper, 'Change answer')
    await answer(wrapper, 'Merge')
    await press(wrapper, 'Save change')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('The task is closed')
  })

  it('stays open through the draft, which outlives the widget', () => {
    const start = entry()
    const wrapper = card(start, { draft: draftFromAnswer(start.request) })
    expect(checkedLabels(wrapper)).toEqual(['Keep'])
    expect(wrapper.text()).toContain('Save change')
  })

  // Moving on to the next question is for one just dealt with; a change is still this one's.
  it('keeps the keyboard on a question whose answer changed in the list', async () => {
    const [changedOne, waitingOne] = twoQuestions()
    const open = answered(changedOne)
    vi.mocked(fetchInputRequests).mockResolvedValue(requestList([open, waitingOne]))
    vi.mocked(changeInputRequestAnswer).mockResolvedValue({
      ...open,
      request: {
        ...open.request,
        answers: { proceed: false },
        answer_version: 2,
        history: [
          {
            version: 1,
            answers: { proceed: true },
            own: {},
            field_notes: {},
            note: null,
            answered_by: 'user',
            by_person: true,
            answered_at: '2026-10-24T12:00:00Z',
          },
        ],
        revision: 3,
      },
    })
    const wrapper = mount(InputRequestsHub, {
      props: { open: true },
      attachTo: document.body,
      global: {
        plugins: [createI18n({ legacy: false, locale: 'en', messages })],
        stubs: { teleport: true },
      },
    })
    wrappers.push(wrapper)
    await flushPromises()
    await press(wrapper, 'Change answer')
    const changing = present(
      wrapper
        .findAll('.request-card')
        .find((candidate) => candidate.text().includes('Save change')),
      'the card being changed',
    )
    await changing.get('input[type="radio"][value="false"]').setValue(true)
    await flushPromises()
    await press(wrapper, 'Save change')
    await flushPromises()
    expect(changeInputRequestAnswer).toHaveBeenCalledOnce()
    expect(document.activeElement).toBe(changing.element)
  })
})
