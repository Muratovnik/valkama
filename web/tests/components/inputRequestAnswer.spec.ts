/**
 * An answer in the widget: the one comment of every field with options, the comment
 * on the question, and what an answered question shows. Changing it is
 * `inputRequestChange.spec.ts`; the real keyboard is `production-question-answer.spec.ts`.
 */
import { nextTick } from 'vue'
import { createI18n } from 'vue-i18n'

import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import RequestCard from '@/features/input-requests/components/RequestCard.vue'
import { EMPTY_DRAFT } from '@/features/input-requests/utils/validateAnswers.ts'

import { answerInputRequest } from '@/shared/api/inputRequestApi.ts'
import type { InputRequestEntry, InputRequestField } from '@/shared/api/inputRequestModel.ts'
import { messages } from '@/shared/i18n/index.ts'
import { provideReferenceLinks } from '@/shared/lib/referenceLinks.ts'

import { firstAnswer, requestEntry } from '../support/inputRequests.ts'
import { present } from '../support/present.ts'
import { answer } from '../support/radioAnswers.ts'

vi.mock('@/shared/api/inputRequestApi.ts', async (original) => ({
  ...(await original<typeof import('@/shared/api/inputRequestApi.ts')>()),
  answerInputRequest: vi.fn(),
}))

const OWN = 'Your own option'
const options = [
  { id: 'keep', label: 'Keep' },
  { id: 'merge', label: 'Merge' },
]
const route: InputRequestField = {
  id: 'route',
  label: 'Route',
  type: 'choice',
  required: true,
  options,
}
const areas: InputRequestField = {
  id: 'areas',
  label: 'Areas',
  type: 'multi_choice',
  required: false,
  options,
}
const go: InputRequestField = {
  id: 'go',
  label: 'Go',
  type: 'boolean',
  required: true,
  options: [],
}
const why: InputRequestField = {
  id: 'why',
  label: 'Why',
  type: 'text',
  required: false,
  options: [],
}

function asked(fields: InputRequestField[]): InputRequestEntry {
  const entry = requestEntry()
  entry.request.fields = fields
  return entry
}
function given(
  fields: InputRequestField[],
  change: Partial<InputRequestEntry['request']>,
): InputRequestEntry {
  const entry = asked(fields)
  entry.request = {
    ...entry.request,
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
type Wrapper = VueWrapper
const wrappers: Wrapper[] = []
const plugins = () => [createI18n({ legacy: false, locale: 'en', messages })]
function card(entry: InputRequestEntry, props: Record<string, unknown> = {}) {
  const wrapper: Wrapper = mount(RequestCard, {
    props: {
      entry,
      'draft': EMPTY_DRAFT,
      'onUpdate:draft': (draft: unknown) => {
        void wrapper.setProps({ draft })
      },
      ...props,
    },
    attachTo: document.body,
    global: { plugins: plugins() },
  })
  wrappers.push(wrapper)
  return wrapper
}
const buttonNamed = (wrapper: Wrapper, name: string | RegExp) =>
  present(
    wrapper
      .findAll('button')
      .find((control) =>
        typeof name === 'string'
          ? control.text() === name || control.attributes('aria-label') === name
          : name.test(control.attributes('aria-label') ?? control.text()),
      ),
    String(name),
  )
const press = async (wrapper: Wrapper, name: string | RegExp) => {
  await buttonNamed(wrapper, name).trigger('click')
  await flushPromises()
}
const send = (wrapper: Wrapper) => press(wrapper, 'Send')
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

// The owner's rule: one «Comment» per field with options, in place of a row for your own option
// and a comment beside it. With nothing chosen it is sent as the own option, with a choice as the
// field's note; the server contract does not change.
describe('the comment of a field', () => {
  it.each([
    ['a choice', route, 'radio', ['Keep', 'Merge']],
    ['a yes or no', go, 'radio', ['Yes', 'No']],
    ['ticks', areas, 'checkbox', ['Keep', 'Merge']],
  ])('takes no row among the options of %s', (_, field, kind, labels) => {
    const wrapper = card(asked([field]))
    const rows = wrapper.findAll('.request-option')
    expect(rows.map((row) => row.text())).toEqual(labels)
    expect(wrapper.findAll(`input[type="${kind}"]`)).toHaveLength(labels.length)
    expect(wrapper.text()).not.toContain('Your own option')
    expect(wrapper.find('textarea').exists()).toBe(false)
  })

  it('is not offered on a text field, which is its author’s own words already', () => {
    const wrapper = card(asked([why]))
    expect(wrapper.findAll('button[aria-label^="Comment:"]')).toHaveLength(0)
  })

  // A yes or no used to share one row; it stays in a column with the rows of every field.
  it('stacks yes and no, with no row layout left over', () => {
    const wrapper = card(asked([go]))
    expect(wrapper.get('fieldset').classes()).not.toContain('is-row')
  })

  it('opens and closes on one press while it is empty, on the only field too', async () => {
    const wrapper = card(asked([route]))
    const name = 'Comment: Route'
    expect(buttonNamed(wrapper, name).attributes('aria-expanded')).toBe('false')
    await press(wrapper, name)
    expect(buttonNamed(wrapper, name).attributes('aria-expanded')).toBe('true')
    const text = textareaNamed(wrapper, name)
    expect(document.activeElement).toBe(text.element)
    expect(text.attributes('placeholder')).toBe('With nothing chosen, these words are your answer')
    await press(wrapper, name)
    expect(wrapper.find('textarea').exists()).toBe(false)
    await press(wrapper, name)
    await textareaNamed(wrapper, name).setValue('Words')
    await press(wrapper, `${name}: written`)
    expect(textareaNamed(wrapper, name).exists()).toBe(true)
    expect(buttonNamed(wrapper, `${name}: written`).attributes('aria-expanded')).toBe('true')
  })

  it('with nothing chosen is sent as the own option, and answers a required field', async () => {
    const entry = asked([route])
    vi.mocked(answerInputRequest).mockResolvedValue(
      given([route], { own: { route: 'In a week' }, revision: 2 }),
    )
    const wrapper = card(entry)
    await press(wrapper, 'Comment: Route')
    await textareaNamed(wrapper, 'Comment: Route').setValue('  In a week ')
    await send(wrapper)
    expect(answerInputRequest).toHaveBeenCalledExactlyOnceWith(entry, {}, '', {
      own: { route: 'In a week' },
      field_notes: {},
    })
  })

  it('with an option chosen is sent as the note on it', async () => {
    const entry = asked([route, areas])
    vi.mocked(answerInputRequest).mockResolvedValue(given([route, areas], {}))
    const wrapper = card(entry)
    await press(wrapper, 'Comment: Route')
    await textareaNamed(wrapper, 'Comment: Route').setValue('Because of the digest')
    await answer(wrapper, 'Merge')
    await wrapper.get('input[type="checkbox"][value="keep"]').setValue(true)
    await press(wrapper, 'Comment: Areas')
    await textareaNamed(wrapper, 'Comment: Areas').setValue('And this')
    await send(wrapper)
    expect(answerInputRequest).toHaveBeenCalledExactlyOnceWith(
      entry,
      { route: 'merge', areas: ['keep'] },
      '',
      { own: {}, field_notes: { route: 'Because of the digest', areas: 'And this' } },
    )
  })

  it('puts a refusal right as a choice does', async () => {
    const wrapper = card(asked([route]))
    await send(wrapper)
    expect(answerInputRequest).not.toHaveBeenCalled()
    const group = wrapper.get('[role="radiogroup"]')
    expect(group.attributes('aria-invalid')).toBe('true')
    await press(wrapper, 'Comment: Route')
    await textareaNamed(wrapper, 'Comment: Route').setValue('Neither')
    expect(wrapper.get('[role="radiogroup"]').attributes('aria-invalid')).toBeUndefined()
  })

  it('stands for the block’s comment in a block of one question with options', () => {
    const block = /^Comment on the block of questions: /u
    expect(() => buttonNamed(card(asked([route])), block)).toThrow()
    expect(buttonNamed(card(asked([route, why])), block).exists()).toBe(true)
    // A text answer has no comment of its own, so its block keeps one.
    expect(buttonNamed(card(asked([why])), block).exists()).toBe(true)
  })
})

describe('comments', () => {
  // The button this replaces, "Your own answer", took away every required field.
  it('a comment on the question leaves required fields required and refused', async () => {
    const entry = asked([route, why])
    vi.mocked(answerInputRequest).mockResolvedValue(given([route, why], {}))
    const wrapper = card(entry)
    expect(wrapper.text()).toContain('Route · Required')
    await press(wrapper, /^Comment on the block of questions: /u)
    await textareaNamed(wrapper, 'Comment on the block of questions').setValue('On the whole')
    expect(wrapper.text()).toContain('Route · Required')
    await send(wrapper)
    expect(answerInputRequest).not.toHaveBeenCalled()
    await answer(wrapper, 'Keep')
    await send(wrapper)
    expect(answerInputRequest).toHaveBeenCalledExactlyOnceWith(
      entry,
      { route: 'keep' },
      'On the whole',
      { own: {}, field_notes: {} },
    )
  })
})

const answerRows = (wrapper: Wrapper, index = 0) =>
  present(wrapper.findAll('.request-answer')[index], 'field').findAll('.request-option')

describe('an answered question', () => {
  it('shows every option of every field, says which was chosen and offers no control', () => {
    const wrapper = card(
      given([route, areas, go], {
        answers: { route: 'merge', areas: ['keep', 'merge'], go: false },
      }),
    )
    expect(wrapper.find('input').exists()).toBe(false)
    expect(answerRows(wrapper, 0).map((row) => row.text())).toEqual(['Keep', 'Mergeselected'])
    expect(answerRows(wrapper, 1).map((row) => row.text())).toEqual([
      'Keepselected',
      'Mergeselected',
    ])
    expect(answerRows(wrapper, 2).map((row) => row.text())).toEqual(['Yes', 'Noselected'])
    expect(present(answerRows(wrapper, 0)[1], 'row').classes()).toContain('is-chosen')
    expect(present(answerRows(wrapper, 0)[0], 'row').classes()).not.toContain('is-chosen')
    expect(wrapper.findAll('ul[role="list"]')).toHaveLength(3)
  })

  it('stands an own variant as a chosen row with its words, and only where it was used', () => {
    const wrapper = card(given([route, go], { answers: { go: true }, own: { route: 'In a week' } }))
    expect(answerRows(wrapper, 0).map((row) => row.text())).toEqual([
      'Keep',
      'Merge',
      `${OWN}selectedIn a week`,
    ])
    expect(answerRows(wrapper, 1).map((row) => row.text())).toEqual(['Yesselected', 'No'])
  })

  it('quotes a comment under its field and puts the one on the question last', () => {
    const wrapper = card(
      given([route], {
        answers: { route: 'keep' },
        field_notes: { route: 'Field words' },
        note: 'Question words',
      }),
    )
    const field = present(wrapper.findAll('.request-answer')[0], 'field')
    expect(field.get('blockquote').text()).toBe('Comment on this questionField words')
    expect(wrapper.get('.request-reply-note').text()).toBe(
      'Comment on the block of questionsQuestion words',
    )
  })

  it('reads an older answer whose comment stood in for a field as a field with no answer', () => {
    const wrapper = card(given([route], { answers: {}, note: 'Instead of choosing' }))
    expect(answerRows(wrapper).map((row) => row.text())).toEqual(['Keep', 'Merge'])
    expect(wrapper.get('.request-answer').text()).toContain('No answer')
    expect(wrapper.get('.request-reply-note').text()).toContain('Instead of choosing')
  })

  it('keeps a live region to its first line, so an arrival does not read out every option', () => {
    const wrapper = card(given([route], { answers: { route: 'keep' } }))
    const status = wrapper.findAll('[role="status"]')
    expect(status).toHaveLength(1)
    expect(present(status[0], 'status').text()).toMatch(/^You answered/u)
    expect(present(status[0], 'status').text()).not.toContain('Merge')
  })

  it('opens a reference in a description where it stands, with no radio to fight it', () => {
    const open = vi.fn()
    const described: InputRequestField = {
      ...route,
      options: [{ id: 'keep', label: 'Keep', description: 'As MAIN-12 says' }],
    }
    const wrapper = mount(
      {
        components: { RequestCard },
        setup() {
          provideReferenceLinks(() => ({ title: 'Open', open }))
          return { entry: given([described], { answers: { route: 'keep' } }), draft: EMPTY_DRAFT }
        },
        template: '<RequestCard :entry="entry" :draft="draft" />',
      },
      { global: { plugins: plugins() } },
    )
    wrappers.push(wrapper)
    expect(wrapper.find('.request-option .rich-reference').exists()).toBe(true)
    expect(wrapper.find('label').exists()).toBe(false)
  })
})

describe('a form’s option row', () => {
  // A press on a reference inside the label both opened it and chose the option.
  it('holds nothing pressable in its label: a reference is text and a link opens outside', async () => {
    const open = vi.fn()
    const described: InputRequestField = {
      ...route,
      options: [
        { id: 'keep', label: 'Keep', description: 'As MAIN-12 says' },
        { id: 'merge', label: 'Merge', description: 'See [the notes](https://example.com).' },
      ],
    }
    const wrapper = mount(
      {
        components: { RequestCard },
        setup() {
          provideReferenceLinks(() => ({ title: 'Open', open }))
          return { entry: asked([described]), draft: EMPTY_DRAFT }
        },
        template: '<RequestCard :entry="entry" :draft="draft" />',
      },
      { attachTo: document.body, global: { plugins: plugins() } },
    )
    wrappers.push(wrapper)
    expect(wrapper.findAll('label button, label a')).toHaveLength(0)
    expect(present(wrapper.findAll('label')[0], 'label').text()).toContain('As MAIN-12 says')
    await present(
      wrapper
        .findAll('button')
        .find((control) => /Merge/u.test(control.attributes('aria-label') ?? '')),
      'toggle',
    ).trigger('click')
    await nextTick()
    const link = wrapper.get('.request-option a')
    expect(link.element.closest('label')).toBeNull()
    expect(link.attributes('href')).toBe('https://example.com/')
  })
})
