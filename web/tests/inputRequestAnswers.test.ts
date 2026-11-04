import { expect, test } from 'vitest'

import {
  differsFromAnswer,
  draftFromAnswer,
  holdsDraft,
  unsentWords,
} from '@/features/input-requests/utils/answerChange.ts'
import { versionLines } from '@/features/input-requests/utils/answerDisplay.ts'
import { descriptionViews } from '@/features/input-requests/utils/optionDescriptions.ts'
import {
  checkAnswers,
  editField,
  EMPTY_DRAFT,
  hasDraft,
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

test('sends false, leaves out an empty optional field and refuses nothing', () => {
  expect(
    checkAnswers(fields, answers({ proceed: false, branch: 'merge', extra: [], note: 'why' })),
  ).toMatchObject({
    refused: [],
    values: { proceed: false, branch: 'merge', note: 'why' },
  })
})

// A comment explains a choice and never stands in for it, and the server refuses the same
// with "a note no longer stands in for a field".
test('a comment, on the question or on a field, answers nothing', () => {
  expect(checkAnswers(fields, draft({ note: 'My own words' })).refused).toEqual([
    'proceed',
    'branch',
    'note',
  ])
  expect(
    checkAnswers(fields, draft({ answers: { proceed: true }, fieldNotes: { branch: 'Why' } }))
      .refused,
  ).toEqual(['branch', 'note'])
})

test('an own variant answers a required field in place of a value', () => {
  const checked = checkAnswers(
    fields,
    draft({
      answers: { proceed: true, note: 'why' },
      own: { branch: ' In a week ' },
      ownChosen: ['branch'],
    }),
  )
  expect(checked).toMatchObject({
    refused: [],
    values: { proceed: true, note: 'why' },
    own: { branch: 'In a week' },
  })
})

test('an own variant chosen with no words is refused, wherever it stands', () => {
  const given = { proceed: true, branch: 'keep', note: 'why' }
  const blank = (id: string, text = '') =>
    checkAnswers(fields, draft({ answers: given, own: { [id]: text }, ownChosen: [id] })).refused
  expect(blank('branch')).toEqual(['branch'])
  expect(blank('branch', '   ')).toEqual(['branch'])
  // Optional, and with a tick beside it: it was chosen, and must not vanish unsaid.
  expect(
    checkAnswers(fields, draft({ answers: { ...given, extra: ['keep'] }, ownChosen: ['extra'] }))
      .refused,
  ).toEqual(['extra'])
})

test('words of an own variant taken back are kept and not sent', () => {
  const chosen = draft({
    answers: { proceed: true, note: 'why' },
    own: { branch: 'In a week' },
    ownChosen: ['branch'],
  })
  const taken = editField(chosen, 'branch', { ownChosen: false, value: 'keep' })
  expect(taken.own).toEqual({ branch: 'In a week' })
  expect(checkAnswers(fields, taken)).toMatchObject({
    refused: [],
    values: { proceed: true, branch: 'keep', note: 'why' },
    own: {},
  })
})

test('ticks and an own variant stand side by side', () => {
  const checked = checkAnswers(
    fields,
    draft({
      answers: { proceed: true, branch: 'keep', note: 'why', extra: ['merge'] },
      own: { extra: 'And also this' },
      ownChosen: ['extra'],
    }),
  )
  expect(checked.values.extra).toEqual(['merge'])
  expect(checked.own).toEqual({ extra: 'And also this' })
})

test('choosing an own variant of a single answer takes the option away', () => {
  const edited = editField(answers({ branch: 'keep', proceed: true }), 'branch', {
    ownChosen: true,
    value: null,
  })
  expect(edited.answers).toEqual({ proceed: true })
  expect(edited.ownChosen).toEqual(['branch'])
})

test('a draft holds a choice, an own variant or a comment, and neither spaces nor no ticks count', () => {
  expect(hasDraft(undefined)).toBe(false)
  expect(hasDraft(draft({ answers: { extra: [] }, note: '  ' }))).toBe(false)
  expect(hasDraft(answers({ proceed: false }))).toBe(true)
  expect(hasDraft(draft({ note: 'Words' }))).toBe(true)
  expect(hasDraft(draft({ ownChosen: ['branch'] }))).toBe(true)
  expect(hasDraft(draft({ own: { branch: 'Words' } }))).toBe(true)
  expect(hasDraft(draft({ fieldNotes: { branch: 'Words' } }))).toBe(true)
  expect(hasDraft(draft({ fieldNotes: { branch: '  ' } }))).toBe(false)
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
    fieldNotes: { proceed: 'Because' },
    note: 'On the whole',
    own: { branch: 'In a week' },
    ownChosen: ['branch'],
  })
  expect(differsFromAnswer(request, seeded)).toBe(false)
  expect(holdsDraft(request, seeded)).toBe(false)
})

test('a change differs by any part of the answer, and ticks in another order are the same', () => {
  const request = answeredRequest()
  const seeded = draftFromAnswer(request)
  const differs = (edit: Partial<RequestDraft>) =>
    differsFromAnswer(request, { ...seeded, ...edit })
  expect(differs({ answers: { ...seeded.answers, extra: ['merge', 'keep'] } })).toBe(false)
  expect(differs({ note: '  On the whole  ' })).toBe(false)
  // A text written and erased again is back to nothing, and no ticks are no ticks.
  const blank = { ...request, answers: {} }
  const seededBlank = draftFromAnswer(blank)
  expect(differsFromAnswer(blank, { ...seededBlank, answers: { note: '' } })).toBe(false)
  expect(differsFromAnswer(blank, { ...seededBlank, answers: { extra: [] } })).toBe(false)
  expect(differs({ answers: { ...seeded.answers, extra: ['keep'] } })).toBe(true)
  expect(differs({ answers: { ...seeded.answers, proceed: false } })).toBe(true)
  expect(differs({ note: 'Otherwise' })).toBe(true)
  expect(differs({ own: { branch: 'In a month' } })).toBe(true)
  // Taken back, the words stay in the draft and the answer no longer says them.
  expect(differs({ ownChosen: [] })).toBe(true)
  expect(differs({ fieldNotes: {} })).toBe(true)
})

test('opening a change keeps words a closing left behind', () => {
  const request = answeredRequest()
  const left = draft({ note: 'Still mine', own: { extra: 'And this' } })
  expect(unsentWords(left)).toBe('Still mine\n\nAnd this')
  const seeded = draftFromAnswer(request, unsentWords(left))
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
  expect(holdsDraft(closed, draft({ own: { branch: 'Words' } }))).toBe(true)
  expect(holdsDraft(closed, { ...draftFromAnswer(closed), note: 'New' })).toBe(true)
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
