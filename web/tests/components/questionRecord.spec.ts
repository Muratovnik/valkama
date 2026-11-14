/**
 * The frame of a question of any kind, in every state a question passes through: on a choice of
 * options, which its form answers, and on a kind made up here, whose content is a line of text and
 * whose answers are a row of buttons, one of which asks first and one of which puts the question
 * off to a day. The kinds' real content comes later; what is held here is what no kind changes.
 */
import { h } from 'vue'
import { createI18n } from 'vue-i18n'

import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import RequestCard from '@/features/input-requests/components/RequestCard.vue'
import type { KindAnswer } from '@/features/input-requests/utils/questionRecord.ts'
import { EMPTY_DRAFT } from '@/features/input-requests/utils/validateAnswers.ts'
import type { RequestDraft } from '@/features/input-requests/utils/validateAnswers.ts'

import { answerInputRequest, InputRequestError } from '@/shared/api/inputRequestApi.ts'
import type { InputAnswers, InputRequestEntry } from '@/shared/api/inputRequestModel.ts'
import { messages } from '@/shared/i18n/index.ts'

import { firstAnswer, requestEntry } from '../support/inputRequests.ts'
import { present } from '../support/present.ts'
import { answer, checkedLabels } from '../support/radioAnswers.ts'

vi.mock('@/shared/api/inputRequestApi.ts', async (original) => ({
  ...(await original<typeof import('@/shared/api/inputRequestApi.ts')>()),
  answerInputRequest: vi.fn(),
}))

type Wrapper = VueWrapper
const wrappers: Wrapper[] = []
/** When a question was answered or closed, said in one zone so the test reads the same anywhere. */
const datetimeFormats = {
  en: {
    activity: {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'UTC',
    },
  },
} as const
const plugins = () => [createI18n({ legacy: false, locale: 'en', messages, datetimeFormats })]
const DAY = '2099-01-01'

function choiceEntry(): InputRequestEntry {
  const entry = requestEntry()
  entry.request.fields = [
    {
      id: 'route',
      label: 'Route',
      type: 'choice',
      required: true,
      options: [
        { id: 'keep', label: 'Keep', recommended: true },
        { id: 'merge', label: 'Merge' },
      ],
    },
  ]
  return entry
}
/** The made-up kind: one choice the buttons answer, and the day a put-off goes in. */
function madeUpEntry(): InputRequestEntry {
  const entry = requestEntry()
  entry.request.fields = [
    {
      id: 'decision',
      label: 'Decision',
      type: 'choice',
      required: true,
      options: [
        { id: 'do', label: 'Do it' },
        { id: 'drop', label: 'Drop it' },
        { id: 'later', label: 'Later' },
      ],
    },
    { id: 'until', label: 'Until', type: 'text', required: false, options: [] },
  ]
  return entry
}
const MADE_UP: KindAnswer[] = [
  { label: 'Do', answer: { decision: 'do' } },
  { label: 'Drop', answer: { decision: 'drop' }, twoStep: true },
  { label: 'Later…', answer: { decision: 'later' }, later: { field: 'until' } },
]
/** The record's props for the made-up kind, its content one line naming the question. */
const madeUp = {
  props: { kind: 'goal', answers: MADE_UP },
  slots: {
    subject: ({ entry }: { entry: InputRequestEntry }) =>
      h('p', { class: 'made-up-subject' }, `About ${entry.request.title}`),
  },
}

function record(
  entry: InputRequestEntry,
  options: { props?: Record<string, unknown>; slots?: Record<string, unknown> } = {},
) {
  const wrapper: Wrapper = mount(RequestCard, {
    props: {
      entry,
      'draft': EMPTY_DRAFT,
      'standalone': true,
      'onUpdate:draft': (draft: unknown) => {
        void wrapper.setProps({ draft })
      },
      ...options.props,
    },
    slots: options.slots as never,
    attachTo: document.body,
    global: { plugins: plugins() },
  })
  wrappers.push(wrapper)
  return wrapper
}
const buttons = (wrapper: Wrapper) => wrapper.findAll('button').map((button) => button.text())
const buttonNamed = (wrapper: Wrapper, name: string) =>
  present(
    wrapper.findAll('button').find((button) => button.text() === name),
    `button ${name}`,
  )
async function press(wrapper: Wrapper, name: string) {
  await buttonNamed(wrapper, name).trigger('click')
  await flushPromises()
}
const dayInput = (wrapper: Wrapper) => wrapper.get<HTMLInputElement>('input[type="date"]')
const heldDraft = (wrapper: Wrapper) => (wrapper.props() as { draft: RequestDraft }).draft

/** The server's word on a question answered with these values. */
function answeredWith(
  entry: InputRequestEntry,
  answers: InputAnswers,
  change: Partial<InputRequestEntry['request']> = {},
): InputRequestEntry {
  return {
    ...entry,
    request: {
      ...entry.request,
      status: 'answered',
      answers,
      ...firstAnswer,
      answered_by: 'user',
      by_person: true,
      resolved_at: '2026-10-24T12:00:00Z',
      revision: 2,
      ...change,
    },
  }
}
const closed = (
  entry: InputRequestEntry,
  change: Partial<InputRequestEntry['request']>,
): InputRequestEntry => ({
  ...entry,
  request: { ...entry.request, resolved_at: '2026-10-24T12:00:00Z', revision: 2, ...change },
})

/** What a record shows while it waits: its options, its own content, and its answers. */
const ANSWERS = new Set(['Do', 'Drop', 'Later…', "Don't answer", 'Send'])
const seen = (wrapper: Wrapper) => ({
  radios: wrapper.findAll('input[type="radio"]').length,
  subject: wrapper.find('.made-up-subject').exists() ? wrapper.get('.made-up-subject').text() : '',
  answers: buttons(wrapper).filter((name) => ANSWERS.has(name)),
})

/**
 * Each kind as the states are walked through it: what it shows while it waits, what putting
 * something into it is and how that is seen again, the press that sends, and what that sends.
 */
interface Kind {
  /** What answers it, all closed once its deadline has passed. */
  answers: string[]
  heldValue: string
  name: string
  options: { props?: Record<string, unknown>; slots?: Record<string, unknown> }
  /** The answers besides the one pressed, which are busy while it is out. */
  others: string[]
  sendPress: string
  sent: InputAnswers
  unsentLine: string
  waiting: ReturnType<typeof seen>
  entry: () => InputRequestEntry
  fill: (wrapper: Wrapper) => Promise<void>
  held: (wrapper: Wrapper) => string
  send: (wrapper: Wrapper) => Promise<void>
}
const kinds: Kind[] = [
  {
    name: 'a choice of options',
    entry: choiceEntry,
    options: {},
    others: ["Don't answer"],
    answers: ['Send'],
    waiting: { radios: 2, subject: '', answers: ["Don't answer", 'Send'] },
    fill: (wrapper: Wrapper) => answer(wrapper, 'Merge'),
    held: (wrapper: Wrapper) => checkedLabels(wrapper).join(','),
    heldValue: 'Merge',
    sendPress: 'Send',
    send: (wrapper: Wrapper) => press(wrapper, 'Send'),
    sent: { route: 'merge' },
    unsentLine: 'Route: Merge',
  },
  {
    name: 'a made-up kind with its own answers',
    entry: madeUpEntry,
    options: madeUp,
    others: ['Do', 'Drop', 'Later…'],
    answers: ['Do', 'Drop', 'Later…'],
    waiting: { radios: 0, subject: 'About Confirm deployment', answers: ['Do', 'Drop', 'Later…'] },
    fill: async (wrapper: Wrapper) => {
      await press(wrapper, 'Later…')
      await dayInput(wrapper).setValue(DAY)
      await flushPromises()
    },
    held: (wrapper: Wrapper) => dayInput(wrapper).element.value,
    heldValue: DAY,
    sendPress: 'Put off',
    send: (wrapper: Wrapper) => press(wrapper, 'Put off'),
    sent: { decision: 'later', until: DAY },
    unsentLine: DAY,
  },
]

beforeEach(() => {
  vi.resetAllMocks()
})
afterEach(() => {
  for (const wrapper of wrappers.splice(0)) wrapper.unmount()
  document.body.replaceChildren()
})

describe.each(kinds)('the record of $name', (kind) => {
  const mounted = (entry = kind.entry(), props: Record<string, unknown> = {}) =>
    record(entry, { ...kind.options, props: { ...kind.options.props, ...props } })

  it('waits with its content and its answers', () => {
    expect(seen(mounted())).toEqual(kind.waiting)
  })

  it('keeps what was put into it while the question is open, as the host holds it', async () => {
    const first = mounted()
    await kind.fill(first)
    const draft = heldDraft(first)
    first.unmount()
    const again = mounted(kind.entry(), { draft })
    await flushPromises()
    expect(kind.held(again)).toBe(kind.heldValue)
  })

  it('shows what it held as unsent when the question closed some other way', async () => {
    const entry = kind.entry()
    const wrapper = mounted(entry)
    await kind.fill(wrapper)
    await wrapper.setProps({
      entry: closed(entry, { status: 'expired', expired_reason: 'withdrawn' }),
    })
    await flushPromises()
    expect(wrapper.find('.request-unsent').text()).toContain('Not sent.')
    expect(wrapper.find('.request-unsent').text()).toContain(kind.unsentLine)
  })

  it('while sending keeps focus on the press, marks every answer busy and takes no second press', async () => {
    vi.mocked(answerInputRequest).mockReturnValue(new Promise(() => {}))
    const wrapper = mounted()
    await kind.fill(wrapper)
    const pressed = buttonNamed(wrapper, kind.sendPress)
    ;(pressed.element as HTMLElement).focus()
    await kind.send(wrapper)
    expect(document.activeElement).toBe(pressed.element)
    expect(pressed.attributes('aria-disabled')).toBe('true')
    expect(pressed.attributes('disabled')).toBeUndefined()
    for (const name of kind.others)
      expect(buttonNamed(wrapper, name).attributes('aria-disabled')).toBe('true')
    await kind.send(wrapper)
    expect(answerInputRequest).toHaveBeenCalledOnce()
  })

  it('that did not go keeps all of it, with the reason at its foot', async () => {
    vi.mocked(answerInputRequest).mockRejectedValue(new InputRequestError('changed', 409))
    const wrapper = mounted()
    await kind.fill(wrapper)
    await kind.send(wrapper)
    const reason = wrapper.get('.request-foot [role="alert"]')
    expect(reason.text()).toBe(
      'This request changed or closed. Check its status; your draft is kept.',
    )
    expect(document.activeElement).toBe(reason.element)
    expect(kind.held(wrapper)).toBe(kind.heldValue)
  })

  it('answered folds to the question and the answer, with who and when', async () => {
    const entry = kind.entry()
    vi.mocked(answerInputRequest).mockResolvedValue(answeredWith(entry, kind.sent))
    const wrapper = mounted(entry)
    await kind.fill(wrapper)
    await kind.send(wrapper)
    expect(vi.mocked(answerInputRequest).mock.calls[0]?.[1]).toEqual(kind.sent)
    expect(wrapper.get('.request-state').text()).toMatch(/^You answered.*Oct\s24,\s2026/u)
    expect(wrapper.get('.request-fold').text()).toContain('Should deployment proceed?')
    expect(buttons(wrapper)).not.toContain(kind.sendPress)
    expect(heldDraft(wrapper)).toEqual(EMPTY_DRAFT)
  })

  it('answered elsewhere folds the same, with what it held kept in sight as not sent', async () => {
    const entry = kind.entry()
    const wrapper = mounted(entry)
    await kind.fill(wrapper)
    await wrapper.setProps({
      entry: answeredWith(entry, kind.sent, { answered_by: 'claude', by_person: false }),
    })
    await flushPromises()
    expect(wrapper.get('.request-state').text()).toContain('Answered by agent claude')
    expect(wrapper.get('.request-unsent').text()).toContain('Not sent.')
  })

  it('withdrawn as its task closed says so with the task, and shows the draft as unsent', async () => {
    const entry = kind.entry()
    const wrapper = mounted(entry)
    await kind.fill(wrapper)
    await wrapper.setProps({
      entry: closed(entry, { status: 'expired', expired_reason: 'task_closed' }),
    })
    await flushPromises()
    expect(wrapper.get('.request-state').text()).toMatch(
      /^Question withdrawn: TASK-7 was closed · Oct\s24,\s2026/u,
    )
    expect(wrapper.get('.request-unsent').text()).toContain(kind.unsentLine)
  })

  it('past its deadline says so and takes no answer, as before kinds', async () => {
    const entry = kind.entry()
    entry.request.expires_at = '2020-01-01T00:00:00Z'
    const wrapper = mounted(entry)
    await flushPromises()
    expect(wrapper.text()).toContain('The deadline has passed on this device.')
    for (const name of kind.answers)
      expect(buttonNamed(wrapper, name).attributes('disabled')).toBeDefined()
  })
})

const madeUpRecord = () => record(madeUpEntry(), madeUp)

describe('the answers of a kind', () => {
  it('write at one press what the answer says', async () => {
    const entry = madeUpEntry()
    vi.mocked(answerInputRequest).mockResolvedValue(answeredWith(entry, { decision: 'do' }))
    const wrapper = record(entry, madeUp)
    await press(wrapper, 'Do')
    expect(answerInputRequest).toHaveBeenCalledExactlyOnceWith(entry, { decision: 'do' }, '', {
      own: {},
      field_notes: {},
    })
  })

  it('send no day a put-off was given when another answer is pressed', async () => {
    const entry = madeUpEntry()
    vi.mocked(answerInputRequest).mockResolvedValue(answeredWith(entry, { decision: 'do' }))
    const wrapper = record(entry, madeUp)
    await press(wrapper, 'Later…')
    await dayInput(wrapper).setValue(DAY)
    await press(wrapper, 'Do')
    expect(vi.mocked(answerInputRequest).mock.calls[0]?.[1]).toEqual({ decision: 'do' })
  })

  it('ask first for the one that cannot be taken back, in place, and write nothing yet', async () => {
    const wrapper = madeUpRecord()
    const drop = buttonNamed(wrapper, 'Drop')
    ;(drop.element as HTMLElement).focus()
    await press(wrapper, 'Drop')
    expect(answerInputRequest).not.toHaveBeenCalled()
    expect(wrapper.get('.request-asked').text()).toBe('«Drop» — are you sure?')
    // Its own box says Back, so a second press where the first was only goes back.
    expect(drop.text()).toBe('Back')
    expect(document.activeElement).toBe(drop.element)
    expect(buttons(wrapper)).toEqual(expect.arrayContaining(['Do', 'Back', 'Drop']))
    await drop.trigger('click')
    await flushPromises()
    expect(wrapper.find('.request-asked').exists()).toBe(false)
    expect(buttons(wrapper)).toEqual(expect.arrayContaining(['Do', 'Drop', 'Later…']))
    expect(answerInputRequest).not.toHaveBeenCalled()
  })

  it('write the one that asked once its asking is answered', async () => {
    const entry = madeUpEntry()
    vi.mocked(answerInputRequest).mockResolvedValue(answeredWith(entry, { decision: 'drop' }))
    const wrapper = record(entry, madeUp)
    await press(wrapper, 'Drop')
    const confirm = present(
      wrapper.findAll('button').find((button) => button.classes('variant-danger')),
      'the danger press',
    )
    expect(confirm.text()).toBe('Drop')
    await confirm.trigger('click')
    await flushPromises()
    expect(vi.mocked(answerInputRequest).mock.calls[0]?.[1]).toEqual({ decision: 'drop' })
  })

  it('end the asking on Escape, with focus left on the box that asked', async () => {
    const wrapper = madeUpRecord()
    const drop = buttonNamed(wrapper, 'Drop')
    ;(drop.element as HTMLElement).focus()
    await press(wrapper, 'Drop')
    await drop.trigger('keydown', { key: 'Escape' })
    await flushPromises()
    expect(wrapper.find('.request-asked').exists()).toBe(false)
    expect(drop.text()).toBe('Drop')
    expect(document.activeElement).toBe(drop.element)
  })

  it('put the question off only once a day from today on is chosen, saying why not before', async () => {
    const wrapper = madeUpRecord()
    const later = buttonNamed(wrapper, 'Later…')
    expect(later.attributes('aria-expanded')).toBe('false')
    await press(wrapper, 'Later…')
    expect(later.attributes('aria-expanded')).toBe('true')
    expect(later.attributes('aria-controls')).toBe(wrapper.get('.request-later').attributes('id'))
    expect(document.activeElement).toBe(dayInput(wrapper).element)
    const putOff = () => buttonNamed(wrapper, 'Put off')
    expect(putOff().attributes('disabled')).toBeDefined()
    expect(wrapper.get('.request-later-reason').text()).toBe('Choose the day to come back to it.')
    await dayInput(wrapper).setValue('2000-01-01')
    expect(putOff().attributes('disabled')).toBeDefined()
    expect(wrapper.get('.request-later-reason').text()).toBe('Choose today or a later day.')
    await dayInput(wrapper).setValue(DAY)
    expect(putOff().attributes('disabled')).toBeUndefined()
    expect(wrapper.find('.request-later-reason').exists()).toBe(false)
    await press(wrapper, 'Later…')
    expect(wrapper.find('.request-later').exists()).toBe(false)
  })
})

describe('the head of a record', () => {
  it('says the space before the number and the project after it, where the listing names them', () => {
    const wrapper = record(choiceEntry(), {
      props: {
        space: { key: 'TASK', name: 'Field Notes' },
        project: { id: 'valkama', title: 'Valkama' },
      },
    })
    expect(wrapper.get('.request-context').text()).toBe('Field Notes · TASK-7 · Valkama')
  })
})
