/**
 * A list an agent put under its comment, in the card's discussion: where it stands, that it is
 * no question waiting, and its four states — waiting for ticks, sent, being changed, frozen by
 * its closed task. The built page and its geometry are `production-comment-list.spec.ts`.
 */
import { createI18n } from 'vue-i18n'

import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import InspectorDiscussion from '@/widgets/work-item-inspector/components/InspectorDiscussion.vue'
import InspectorOverview from '@/widgets/work-item-inspector/components/InspectorOverview.vue'

import {
  answerInputRequest,
  changeInputRequestAnswer,
  fetchInputRequest,
  fetchInputRequests,
  InputRequestError,
} from '@/shared/api/inputRequestApi.ts'
import type { InputRequestEntry } from '@/shared/api/inputRequestModel.ts'
import type { WorkItem } from '@/shared/api/planningModel.ts'
import { i18n, messages } from '@/shared/i18n/index.ts'

import { requestEntry, requestList } from '../support/inputRequests.ts'
import { card, open, root, thread, unmountAll } from '../support/threadCard.ts'

vi.mock('@/shared/api/inputRequestApi.ts', async (original) => ({
  ...(await original<typeof import('@/shared/api/inputRequestApi.ts')>()),
  answerInputRequest: vi.fn(),
  changeInputRequestAnswer: vi.fn(),
  fetchInputRequest: vi.fn(),
  fetchInputRequests: vi.fn(),
}))

afterEach(unmountAll)
beforeEach(() => vi.clearAllMocks())

const LIST_ID = '77777777-7777-4777-8777-777777777777'
const ANSWERED_AT = '2026-10-24T12:00:00Z'

/** A list under the root comment 1, as the server reads it: one field of ticks. */
function list(change: Partial<InputRequestEntry['request']> = {}): InputRequestEntry {
  const entry = requestEntry()
  entry.request = {
    ...entry.request,
    request_id: LIST_ID,
    kind: 'question',
    prompt: 'What to take on',
    comment_id: 1,
    fields: [
      {
        id: 'items',
        label: 'What to take on',
        type: 'multi_choice',
        required: false,
        options: [
          { id: 'a', label: 'Widen the check', recommended: true },
          { id: 'b', label: 'Fix the docs' },
          { id: 'c', label: 'Split the guard' },
        ],
      },
    ],
    ...change,
  }
  return entry
}
const sent = (items: string[], change: Partial<InputRequestEntry['request']> = {}) =>
  list({
    status: 'answered',
    answers: { items },
    own: {},
    field_notes: {},
    answer_version: 1,
    answered_by: 'user',
    by_person: true,
    resolved_at: ANSWERED_AT,
    revision: 2,
    ...change,
  })
/** A question of the same card that does wait for an answer. */
const question = () => requestEntry()
const closed = (item: WorkItem): WorkItem => ({
  ...item,
  state: { ...item.state, key: 'done', category: 'completed', is_terminal: true },
})

/** The discussion in a language, with the app's own time formats. */
function discussion(item: WorkItem, questions: InputRequestEntry[], locale: 'en' | 'ru' = 'en') {
  const datetimeFormats = {
    en: i18n.global.getDateTimeFormat('en'),
    ru: i18n.global.getDateTimeFormat('ru'),
  }
  return mount(InspectorDiscussion, {
    props: { item, writable: true, questions },
    global: { plugins: [createI18n({ legacy: false, locale, messages, datetimeFormats })] },
  })
}

const listIn = (wrapper: VueWrapper) => thread(wrapper, 1).get('.comment-list')
const boxes = (wrapper: VueWrapper) => listIn(wrapper).findAll('input[type="checkbox"]')
const named = (wrapper: VueWrapper, name: string) =>
  listIn(wrapper)
    .findAll('button')
    .filter((button) => button.text() === name || button.attributes('aria-label') === name)
const press = async (wrapper: VueWrapper, name: string) => {
  const [button] = named(wrapper, name)
  if (!button) throw new Error(`No ${name} in the list`)
  await button.trigger('click')
  await flushPromises()
}
const tick = async (wrapper: VueWrapper, index: number, checked = true) => {
  await boxes(wrapper)[index]?.setValue(checked)
  await flushPromises()
}

/** The discussion heading's counts over a card with these questions. */
const counted = (questions: InputRequestEntry[]) =>
  open(card([root(1)]), { questions })
    .get('.section-header')
    .text()
/** What the list says in Russian. */
function russian(item: WorkItem, questions: InputRequestEntry[]) {
  const wrapper = discussion(item, questions, 'ru')
  const text = listIn(wrapper).text()
  wrapper.unmount()
  return text
}
/** What the card's overview says about waiting for an answer, with these questions on it. */
async function asking(entries: InputRequestEntry[]) {
  vi.mocked(fetchInputRequests).mockResolvedValue(requestList(entries))
  const item = card([root(1)])
  const target = { ...requestEntry().target }
  const wrapper = mount(InspectorOverview, {
    props: { item, target, writable: true },
    global: {
      plugins: [createI18n({ legacy: false, locale: 'en', messages })],
      stubs: { InspectorDescription: true, InspectorSummary: true },
    },
    attachTo: document.body,
  })
  await flushPromises()
  const said = wrapper.emitted('update:asking') ?? []
  wrapper.unmount()
  // The model starts false and says nothing until it changes.
  return said.at(-1)?.[0] ?? false
}

describe('a list under a comment', () => {
  it('stands under its comment in the comment’s article, and not among the questions', () => {
    const wrapper = open(card([root(1)]), { questions: [list(), question()] })
    const article = thread(wrapper, 1)
    expect(article.element.tagName).toBe('ARTICLE')
    // Under the words of the comment, in its own sheet.
    const parts = [...article.element.children]
    expect(parts.findIndex((child) => child.classList.contains('comment-list'))).toBeGreaterThan(
      parts.findIndex((child) => child.classList.contains('thread-text')),
    )
    // The question stands as a question; the list does not.
    expect(wrapper.findAll('.request-card')).toHaveLength(1)
    expect(wrapper.get('.request-card').text()).not.toContain('What to take on')
    expect(boxes(wrapper)).toHaveLength(3)
    // Nobody waits on it, and the comment's head already says who wrote it.
    expect(named(wrapper, "Don't answer")).toHaveLength(0)
    expect(listIn(wrapper).find('.meta-line').exists()).toBe(false)
    expect(listIn(wrapper).text()).toContain('recommended')
  })

  it('adds no thread and nothing unresolved to the heading’s counts', () => {
    expect(counted([list(), question()])).toBe(counted([question()]))
    expect(counted([list()])).toBe(counted([]))
  })

  it('ticks only tick, and one press sends them all', async () => {
    vi.mocked(answerInputRequest).mockImplementation(async (entry, answers) => ({
      ...sent((answers as { items: string[] }).items),
      target: entry.target,
    }))
    const wrapper = open(card([root(1)]), { questions: [list()] })
    await tick(wrapper, 0)
    await tick(wrapper, 2)
    expect(answerInputRequest).not.toHaveBeenCalled()
    await press(wrapper, 'Send marks')
    expect(answerInputRequest).toHaveBeenCalledTimes(1)
    expect(vi.mocked(answerInputRequest).mock.calls[0]?.[1]).toEqual({ items: ['a', 'c'] })
    expect(boxes(wrapper)).toHaveLength(0)
    expect(listIn(wrapper).text()).toContain('You ticked 2 of 3')
  })

  it('sends with nothing ticked, as the owner allows: none of the marks, and nothing refused', async () => {
    vi.mocked(answerInputRequest).mockImplementation(async (entry, answers) => ({
      ...sent((answers as { items: string[] }).items),
      target: entry.target,
    }))
    const wrapper = open(card([root(1)]), { questions: [list()] })
    await press(wrapper, 'Send marks')
    expect(answerInputRequest).toHaveBeenCalledTimes(1)
    expect(vi.mocked(answerInputRequest).mock.calls[0]?.[1]).toEqual({ items: [] })
    expect(listIn(wrapper).text()).not.toContain('Tick at least one option.')
    expect(listIn(wrapper).text()).toContain('You ticked 0 of 3')
  })

  it('saves a change that unticks every mark', async () => {
    vi.mocked(changeInputRequestAnswer).mockImplementation(async (entry, answers) => ({
      ...sent((answers as { items: string[] }).items, { revision: 3, answer_version: 2 }),
      target: entry.target,
    }))
    const wrapper = open(card([root(1)]), { questions: [sent(['a'])] })
    await press(wrapper, 'Change')
    await tick(wrapper, 0, false)
    await press(wrapper, 'Save change')
    expect(vi.mocked(changeInputRequestAnswer).mock.calls[0]?.[1]).toEqual({ items: [] })
    expect(listIn(wrapper).text()).not.toContain('Tick at least one option.')
    expect(listIn(wrapper).text()).toContain('You ticked 0 of 3')
  })

  it('sent: every row with its mark, how many and when, and the way to change them', () => {
    const wrapper = discussion(card([root(1)]), [sent(['a', 'c'])])
    const rows = listIn(wrapper).findAll('.request-option')
    expect(rows).toHaveLength(3)
    expect(rows.map((row) => row.find('.comment-list-mark svg').exists())).toEqual([
      true,
      false,
      true,
    ])
    const line = listIn(wrapper).get('.request-state').text()
    expect(line).toMatch(/^You ticked 2 of 3 · /u)
    // The time is one phrase that a line does not break inside.
    expect(line.split(' · ')[1]).toMatch(/2026/u)
    expect(line.split(' · ')[1]).not.toContain(' ')
    wrapper.unmount()
    expect(named(wrapper, 'Change')).toHaveLength(1)
    expect(named(wrapper, 'Send marks')).toHaveLength(0)
  })

  it('says each state in Russian', () => {
    expect(russian(card([root(1)]), [list()])).toContain('Отправить отметки')
    const answered = russian(card([root(1)]), [sent(['a', 'b'])])
    expect(answered).toMatch(/Вы отметили 2 из 3 · /u)
    expect(answered).toContain('Изменить')
    expect(russian(closed(card([root(1)])), [list()])).toContain(
      'Задача закрыта: отметки не дошли бы ни до кого. Откройте задачу, чтобы отметить.',
    )
  })

  it('a change opens on what was sent, and saves against the revision it opened on', async () => {
    vi.mocked(changeInputRequestAnswer).mockImplementation(async (entry, answers) => ({
      ...sent((answers as { items: string[] }).items, { revision: 3, answer_version: 2 }),
      target: entry.target,
    }))
    const wrapper = open(card([root(1)]), { questions: [sent(['a'])] })
    await press(wrapper, 'Change')
    expect(boxes(wrapper).map((box) => (box.element as HTMLInputElement).checked)).toEqual([
      true,
      false,
      false,
    ])
    expect(named(wrapper, 'Save change')[0]?.attributes('disabled')).toBeDefined()
    await tick(wrapper, 1)
    await press(wrapper, 'Save change')
    const [entry, answers] = vi.mocked(changeInputRequestAnswer).mock.calls[0] ?? []
    expect(answers).toEqual({ items: ['a', 'b'] })
    expect(entry?.request.revision).toBe(2)
    expect(listIn(wrapper).text()).toContain('You ticked 2 of 3')
  })

  it('a change that meets marks changed elsewhere keeps its ticks and overwrites nothing', async () => {
    vi.mocked(changeInputRequestAnswer).mockRejectedValue(
      new InputRequestError('revision_conflict', 409),
    )
    vi.mocked(fetchInputRequest).mockResolvedValue({
      ...sent(['c'], { revision: 5, answer_version: 2 }),
      target: list().target,
    })
    const wrapper = open(card([root(1)]), { questions: [sent(['a'])] })
    await press(wrapper, 'Change')
    await tick(wrapper, 1)
    await press(wrapper, 'Save change')
    expect(listIn(wrapper).get('[role="alert"]').text()).toContain('your draft is kept')
    expect(boxes(wrapper).map((box) => (box.element as HTMLInputElement).checked)).toEqual([
      true,
      true,
      false,
    ])
    expect(named(wrapper, 'Save change')[0]?.attributes('disabled')).toBeDefined()
    await press(wrapper, 'Check status')
    vi.mocked(changeInputRequestAnswer).mockResolvedValue({
      ...sent(['a', 'b'], { revision: 6, answer_version: 3 }),
      target: list().target,
    })
    await press(wrapper, 'Save change')
    expect(vi.mocked(changeInputRequestAnswer).mock.lastCall?.[0].request.revision).toBe(5)
  })

  it('frozen by its closed task: nothing to press, and what was ticked and not sent in sight', async () => {
    const wrapper = open(card([root(1)]), { questions: [list()] })
    await tick(wrapper, 1)
    await wrapper.setProps({ item: closed(card([root(1)])) })
    const text = listIn(wrapper).text()
    expect(text).toContain(
      'The task is closed: marks would reach no one. Reopen the task to tick them.',
    )
    expect(text).toContain('Not sent. This is what you had chosen:')
    expect(text).toContain('What to take on: Fix the docs')
    expect(boxes(wrapper)).toHaveLength(0)
    expect(listIn(wrapper).findAll('button')).toHaveLength(0)
    // Reopened, the tick is there to send.
    await wrapper.setProps({ item: card([root(1)]) })
    expect(boxes(wrapper).map((box) => (box.element as HTMLInputElement).checked)).toEqual([
      false,
      true,
      false,
    ])
  })

  it('frozen once sent: the marks stay, and no change is offered', () => {
    const wrapper = open(closed(card([root(1)])), { questions: [sent(['b'])] })
    const text = listIn(wrapper).text()
    expect(text).toContain('You ticked 1 of 3')
    expect(text).toContain('The task is closed: marks would reach no one.')
    expect(named(wrapper, 'Change')).toHaveLength(0)
  })
})

describe('what waits for an answer on the card', () => {
  it('is never a list, however many of them wait for ticks', async () => {
    expect(
      await asking([list(), list({ request_id: '88888888-8888-4888-8888-888888888888' })]),
    ).toBe(false)
    expect(await asking([list(), question()])).toBe(true)
  })
})
