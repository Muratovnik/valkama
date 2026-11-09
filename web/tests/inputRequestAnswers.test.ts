import { expect, test } from 'vitest'

import {
  differsFromAnswer,
  draftFromAnswer,
  holdsDraft,
  unsentWords,
} from '@/features/input-requests/utils/answerChange.ts'
import { unsentChoices, versionLines } from '@/features/input-requests/utils/answerDisplay.ts'
import { descriptionViews } from '@/features/input-requests/utils/optionDescriptions.ts'
import {
  checkAnswers,
  editField,
  EMPTY_DRAFT,
  hasDraft,
  stillRefused,
} from '@/features/input-requests/utils/validateAnswers.ts'
import type { RequestDraft } from '@/features/input-requests/utils/validateAnswers.ts'

import type { InputRequestField } from '@/shared/api/inputRequestModel.ts'
import { inputRequestMessages } from '@/shared/i18n/inputRequestMessages.ts'

import { firstAnswer, requestEntry } from './support/inputRequests.ts'

const options = [
  { id: 'keep', label: 'Keep' },
  { id: 'merge', label: 'Merge' },
]
const fields: InputRequestField[] = [
  { id: 'proceed', label: 'Proceed', type: 'boolean', required: true, options: [] },
  { id: 'branch', label: 'Branch', type: 'choice', required: true, options },
  { id: 'extra', label: 'Extra', type: 'multi_choice', required: false, options },
  { id: 'note', label: 'Note', type: 'text', required: true, options: [] },
]
const draft = (change: Partial<RequestDraft>): RequestDraft => ({ ...EMPTY_DRAFT, ...change })
const answers = (values: RequestDraft['answers']) => draft({ answers: values })

test('names every refused field, in the order the question lists them', () => {
  expect(checkAnswers(fields, EMPTY_DRAFT)).toMatchObject({
    refused: ['proceed', 'branch', 'note'],
    values: {},
  })
})

test('refuses a value that is present but not an answer', () => {
  const { refused } = checkAnswers(
    fields,
    answers({ proceed: 'true', branch: 'unknown', note: '   ' }),
  )
  expect(refused).toEqual(['proceed', 'branch', 'note'])
})

test('asks for something at the first field when nothing is chosen or written, required or not', () => {
  const optional = [
    { id: 'extra', label: 'Extra', type: 'multi_choice', required: false, options: [] },
    { id: 'words', label: 'Words', type: 'text', required: false, options: [] },
  ] as InputRequestField[]
  expect(checkAnswers(optional, EMPTY_DRAFT).refused).toEqual(['extra'])
  expect(
    checkAnswers(optional, draft({ answers: { extra: [], words: '' }, note: '   ' })).refused,
  ).toEqual(['extra'])
  expect(checkAnswers(optional, draft({ note: 'Words of my own' }))).toMatchObject({
    refused: [],
    values: {},
  })
  expect(checkAnswers(optional, answers({ words: 'A word' }))).toMatchObject({
    refused: [],
    values: { words: 'A word' },
  })
})

test('a list sends its ticks as they stand, none ticked too, which the agent reads as not decided', () => {
  // The owner's rule: the marks go with one send, and a send with nothing ticked is allowed.
  const items = [
    { id: 'items', label: 'What to take on', type: 'multi_choice', required: false, options },
  ] as InputRequestField[]
  for (const nothing of [EMPTY_DRAFT, answers({ items: [] })])
    expect(checkAnswers(items, nothing, { list: true })).toMatchObject({
      refused: [],
      values: { items: [] },
    })
  expect(checkAnswers(items, answers({ items: ['merge'] }), { list: true })).toMatchObject({
    refused: [],
    values: { items: ['merge'] },
  })
  // A tick that is no option of the list is still no answer.
  expect(checkAnswers(items, answers({ items: ['gone'] }), { list: true }).refused).toEqual([
    'items',
  ])
  // The same field in a question still asks for something: an empty answer tells nothing.
  expect(checkAnswers(items, EMPTY_DRAFT).refused).toEqual(['items'])
  expect(checkAnswers(fields, EMPTY_DRAFT, { list: false }).refused).toEqual([
    'proceed',
    'branch',
    'note',
  ])
})

test('sends false, leaves out an empty optional field and refuses nothing', () => {
  expect(
    checkAnswers(fields, answers({ proceed: false, branch: 'merge', extra: [], note: 'why' })),
  ).toMatchObject({
    refused: [],
    values: { proceed: false, branch: 'merge', note: 'why' },
  })
})

// The comment on the question explains the answer and never stands in for it, and the server
// refuses the same with "a note no longer stands in for a field".
test('the comment on the question answers nothing', () => {
  expect(checkAnswers(fields, draft({ note: 'My own words' })).refused).toEqual([
    'proceed',
    'branch',
    'note',
  ])
})

// The owner's rule for the one «Comment» of a field: with nothing chosen it goes as the own
// option, with something chosen as the field's note. The server contract does not change.
test('a comment with nothing chosen is the own option, and answers a required field', () => {
  const checked = checkAnswers(
    fields,
    draft({ answers: { proceed: true, note: 'why' }, comments: { branch: ' In a week ' } }),
  )
  expect(checked).toMatchObject({
    refused: [],
    values: { proceed: true, note: 'why' },
    own: { branch: 'In a week' },
    fieldNotes: {},
  })
})

test('a comment beside a choice, Yes or No or a tick is the note on it', () => {
  const checked = checkAnswers(
    fields,
    draft({
      answers: { proceed: false, branch: 'keep', extra: ['merge'], note: 'why' },
      comments: { proceed: 'Because', branch: 'For now', extra: 'And also this' },
    }),
  )
  expect(checked).toMatchObject({
    refused: [],
    values: { proceed: false, branch: 'keep', extra: ['merge'], note: 'why' },
    own: {},
    fieldNotes: { proceed: 'Because', branch: 'For now', extra: 'And also this' },
  })
})

test('ticks all taken back leave the comment as the own option', () => {
  const checked = checkAnswers(
    fields,
    draft({
      answers: { proceed: true, branch: 'keep', note: 'why', extra: [] },
      comments: { extra: 'None of these' },
    }),
  )
  expect(checked.own).toEqual({ extra: 'None of these' })
  expect(checked.fieldNotes).toEqual({})
  expect(checked.values).not.toHaveProperty('extra')
})

test('a comment of spaces is no comment, and a text answer has none', () => {
  const checked = checkAnswers(
    fields,
    draft({ answers: { proceed: true }, comments: { branch: '   ', note: 'Words' } }),
  )
  expect(checked.refused).toEqual(['branch', 'note'])
  expect(checked.own).toEqual({})
})

test('choosing after writing turns the same words from the own option into a note', () => {
  const written = draft({ answers: { proceed: true, note: 'why' }, comments: { branch: 'Later' } })
  const chosen = editField(written, 'branch', { value: 'merge' })
  expect(chosen.comments).toEqual({ branch: 'Later' })
  expect(checkAnswers(fields, chosen)).toMatchObject({ own: {}, fieldNotes: { branch: 'Later' } })
  const unchosen = editField(chosen, 'branch', { value: null })
  expect(checkAnswers(fields, unchosen)).toMatchObject({ own: { branch: 'Later' } })
})

test('a draft holds a choice or a comment, and neither spaces nor no ticks count', () => {
  expect(hasDraft(undefined)).toBe(false)
  expect(hasDraft(draft({ answers: { extra: [] }, note: '  ' }))).toBe(false)
  expect(hasDraft(answers({ proceed: false }))).toBe(true)
  expect(hasDraft(draft({ note: 'Words' }))).toBe(true)
  expect(hasDraft(draft({ comments: { branch: 'Words' } }))).toBe(true)
  expect(hasDraft(draft({ comments: { branch: '  ' } }))).toBe(false)
})

test('an edit of the comment puts a refusal right, as an edit of the value does', () => {
  const before = draft({ answers: { proceed: true } })
  expect(
    stillRefused(['branch', 'note'], before, editField(before, 'branch', { comment: 'W' })),
  ).toEqual(['note'])
  expect(stillRefused(['branch'], before, editField(before, 'note', { comment: 'W' }))).toEqual([
    'branch',
  ])
})

function answeredRequest() {
  return {
    ...requestEntry().request,
    fields,
    status: 'answered' as const,
    answers: { proceed: true, extra: ['keep', 'merge'], note: 'why' },
    ...firstAnswer,
    own: { branch: 'In a week' },
    field_notes: { proceed: 'Because' },
    note: 'On the whole',
    revision: 4,
  }
}

test('the form of a change opens on the answer in force and says nothing new', () => {
  const request = answeredRequest()
  const seeded = draftFromAnswer(request)
  expect(seeded).toEqual({
    answers: request.answers,
    changing: 4,
    comments: { proceed: 'Because', branch: 'In a week' },
    note: 'On the whole',
  })
  expect(differsFromAnswer(request, seeded)).toBe(false)
  expect(holdsDraft(request, seeded)).toBe(false)
})

// An answer of the time when a field took both: the decision is to keep both words in the one
// comment, the own option first, and to call that form unchanged until the person changes it.
test('an older answer with an own option and a note on one field opens with both in its comment', () => {
  const request = {
    ...answeredRequest(),
    answers: { proceed: true, extra: ['keep'], note: 'why' },
    own: { extra: 'And this' },
    field_notes: { extra: 'Because' },
  }
  const seeded = draftFromAnswer(request)
  expect(seeded.comments.extra).toBe('And this\n\nBecause')
  expect(differsFromAnswer(request, seeded)).toBe(false)
  // Saved as it stands beside a tick, both go as the note: the server keeps one of the two.
  expect(checkAnswers(fields, seeded).fieldNotes.extra).toBe('And this\n\nBecause')
})

test('a change differs by any part of the answer, and ticks in another order are the same', () => {
  const request = answeredRequest()
  const seeded = draftFromAnswer(request)
  const differs = (edit: Partial<RequestDraft>) =>
    differsFromAnswer(request, { ...seeded, ...edit })
  expect(differs({ answers: { ...seeded.answers, extra: ['merge', 'keep'] } })).toBe(false)
  expect(differs({ note: '  On the whole  ' })).toBe(false)
  expect(differs({ comments: { proceed: ' Because ', branch: 'In a week' } })).toBe(false)
  // A text written and erased again is back to nothing, and no ticks are no ticks.
  const blank = { ...request, answers: {} }
  const seededBlank = draftFromAnswer(blank)
  expect(differsFromAnswer(blank, { ...seededBlank, answers: { note: '' } })).toBe(false)
  expect(differsFromAnswer(blank, { ...seededBlank, answers: { extra: [] } })).toBe(false)
  expect(differs({ answers: { ...seeded.answers, extra: ['keep'] } })).toBe(true)
  expect(differs({ answers: { ...seeded.answers, proceed: false } })).toBe(true)
  expect(differs({ note: 'Otherwise' })).toBe(true)
  expect(differs({ comments: { proceed: 'Because', branch: 'In a month' } })).toBe(true)
  expect(differs({ comments: {} })).toBe(true)
})

test('opening a change keeps words a closing left behind', () => {
  const request = answeredRequest()
  const left = draft({ note: 'Still mine', comments: { extra: 'And this' } })
  expect(unsentWords(request, left)).toBe('Still mine\n\nAnd this')
  const seeded = draftFromAnswer(request, unsentWords(request, left))
  expect(seeded.note).toBe('On the whole\n\nStill mine\n\nAnd this')
  expect(differsFromAnswer(request, seeded)).toBe(true)
})

test('what a leaving asks about follows how the question stands', () => {
  const waiting = requestEntry().request
  const closed = answeredRequest()
  expect(holdsDraft(waiting, undefined)).toBe(false)
  expect(holdsDraft(waiting, answers({ proceed: true }))).toBe(true)
  // A choice left in a form of a question that closed is nobody's words.
  expect(holdsDraft(closed, answers({ proceed: true }))).toBe(false)
  expect(holdsDraft(closed, draft({ comments: { branch: 'Words' } }))).toBe(true)
  expect(holdsDraft(closed, { ...draftFromAnswer(closed), note: 'New' })).toBe(true)
  // A text field's answer is words like any other: a closing used to leave it unsaid.
  expect(holdsDraft(closed, answers({ note: 'Typed out' }))).toBe(true)
})

test('a closing leaves the words of a text answer among the words not sent', () => {
  const closed = answeredRequest()
  const left = draft({ answers: { note: 'Typed out', branch: 'keep' }, note: 'And a comment' })
  // A choice's option id is no one's words: it is said with the choices.
  expect(unsentWords(closed, left)).toBe('Typed out\n\nAnd a comment')
})

/** A key's last word: enough to read the lines by. */
const lastWord = (key: string) => key.split('.').at(-1) ?? ''

test('what a closing left chosen reads as a line per field, by the labels shown', () => {
  const t = lastWord
  const left = draft({
    answers: { proceed: false, branch: 'merge', extra: ['keep', 'merge'], note: 'Words' },
    comments: { extra: 'Mine' },
  })
  expect(unsentChoices(fields, left, t)).toEqual([
    'Proceed: no',
    'Branch: Merge',
    'Extra: Keep, Merge',
  ])
  // A comment is words, said among them; a field with nothing chosen says nothing here.
  expect(unsentChoices(fields, draft({ comments: { branch: 'Mine' } }), t)).toEqual([])
  expect(unsentChoices(fields, EMPTY_DRAFT, t)).toEqual([])
})

const echo = (key: string, values?: Record<string, unknown>) =>
  values ? `${key}(${String(values.text)})` : key

test('a replaced answer reads as a line per field that said something', () => {
  expect(
    versionLines(
      fields,
      {
        answers: { proceed: false, extra: ['keep', 'merge'] },
        own: { branch: 'In a week' },
        field_notes: { proceed: 'Because' },
      },
      echo,
    ),
  ).toEqual([
    { id: 'proceed', text: 'Proceed: requests.no; requests.fieldNoteSaid(Because)' },
    { id: 'branch', text: 'Branch: requests.ownVariantSaid(In a week)' },
    { id: 'extra', text: 'Extra: Keep, Merge' },
  ])
})

/** The real words of a language, filled in as vue-i18n fills a named value. */
const wordsOf = (locale: 'en' | 'ru') => (key: string, values?: Record<string, unknown>) => {
  const text = String(
    (inputRequestMessages[locale].requests as Record<string, unknown>)[key.slice(9)],
  )
  return text.replaceAll(/\{(\w+)\}/gu, (_, name: string) => String(values?.[name]))
}

test('a part that ends its own sentence is not glued to the next by a semicolon', () => {
  const version = {
    answers: { proceed: false },
    own: { branch: 'An own variant (a probe).' },
    field_notes: { branch: 'A note on the field.', proceed: 'Because' },
  }
  expect(versionLines(fields, version, wordsOf('ru'))).toEqual([
    { id: 'proceed', text: 'Proceed: Нет; комментарий: Because' },
    {
      id: 'branch',
      text: 'Branch: свой вариант: An own variant (a probe). Комментарий: A note on the field.',
    },
  ])
  expect(versionLines(fields, version, wordsOf('en'))[1]).toEqual({
    id: 'branch',
    text: 'Branch: own option: An own variant (a probe). Comment: A note on the field.',
  })
  // A question mark, an ellipsis or a closing quote after the stop end a sentence as well.
  for (const own of ['Why not?', 'Perhaps…', '“Keep it.”'])
    expect(
      versionLines(
        fields,
        { answers: {}, own: { branch: own }, field_notes: { branch: 'N' } },
        wordsOf('en'),
      )[0]?.text,
    ).toBe(`Branch: own option: ${own} Comment: N`)
})

test('a line of description holding a link opens on its own press, outside the label', () => {
  const views = descriptionViews([
    { id: 'plain', label: 'Plain', description: 'Says **this** and `no more`.' },
    { id: 'link', label: 'Link', description: 'See [the notes](https://example.com).' },
    { id: 'bare', label: 'Bare', description: 'See https://example.com for more.' },
    { id: 'deep', label: 'Deep', description: '**See [the notes](https://example.com).**' },
    { id: 'none', label: 'None' },
  ])
  expect(Object.fromEntries(views)).toEqual({
    plain: 'line',
    link: 'excerpt',
    bare: 'excerpt',
    deep: 'excerpt',
    none: 'none',
  })
})
