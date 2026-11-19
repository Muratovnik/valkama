/**
 * Which kind a question is shown as, by the server's purpose, and the answers its buttons write,
 * against the fields the server asks each purpose with: the field `answer` with its options, and
 * `until` where a put-off names its day or card. The words are the kinds table's.
 */
import { describe, expect, it } from 'vitest'

import { kindOf, kindRecord } from '@/features/input-requests/utils/questionKinds.ts'

import type { InputRequestEntry, InputRequestField } from '@/shared/api/inputRequestModel.ts'

import { requestEntry } from './support/inputRequests.ts'

type Purpose = InputRequestEntry['request']['purpose']

const choice = (...options: string[]): InputRequestField => ({
  id: 'answer',
  label: 'Answer',
  type: 'choice',
  required: true,
  options: options.map((id) => ({ id, label: `server ${id}` })),
})
const text = (id: string): InputRequestField => ({
  id,
  label: id,
  type: 'text',
  required: false,
  options: [],
})

function asked(purpose: Purpose, fields: InputRequestField[]): InputRequestEntry {
  const entry = requestEntry()
  entry.request = { ...entry.request, purpose, fields }
  return entry
}

/** The words of the kinds table, by the option each answers with. */
const WORDS: Record<string, string> = {
  accept: 'Accept',
  return: 'Return to work',
  do: 'Do',
  later: 'Later…',
  drop: 'Don’t do',
  out: 'Move out of the goal',
  allow: 'Allow',
  keep: 'Keep',
  cancel: 'Cancel',
  confirm: 'I confirm',
  leave: 'Leave to the next session',
}
const word = (option: string) => WORDS[option] ?? `missing ${option}`

/** The server's fields of each purpose (`request_model.py`), in the order it asks them. */
const ASKED: [Purpose, InputRequestField[]][] = [
  ['review', [choice('accept', 'return')]],
  ['confirm', [choice('confirm', 'leave')]],
  ['return', [choice('do', 'later', 'drop'), text('until'), text('cancels')]],
  ['goal', [choice('do', 'later', 'drop'), text('until'), text('cancels')]],
  ['task', [choice('do', 'later', 'out', 'drop'), text('until')]],
  ['cancel', [choice('cancel', 'keep'), text('cancels')]],
  ['condition', [choice('allow', 'keep')]],
  ['triage', [choice('do', 'later', 'drop'), text('until'), text('cancels')]],
]

describe('the kind of a question', () => {
  it.each(ASKED)('is its purpose %s', (purpose, fields) => {
    expect(kindOf(asked(purpose, fields))).toBe(purpose)
  })

  it('is a choice of options without a purpose, and for the consent asked of sessions', () => {
    expect(kindOf(asked(null, [choice('a', 'b')]))).toBe('choice')
    expect(kindOf(asked('consent', [choice('agree', 'object', 'moved_out')]))).toBe('choice')
  })
})

const labels = (purpose: Purpose, fields: InputRequestField[]) =>
  kindRecord(asked(purpose, fields), word).answers.map((answer) => answer.label)

describe('the answers of a kind', () => {
  it('stand in the kinds table’s words and order', () => {
    expect(
      Object.fromEntries(ASKED.map(([purpose, fields]) => [purpose, labels(purpose, fields)])),
    ).toEqual({
      review: ['Accept', 'Return to work'],
      confirm: ['I confirm', 'Leave to the next session'],
      return: ['Do', 'Later…', 'Don’t do'],
      goal: ['Do', 'Later…', 'Don’t do'],
      task: ['Do', 'Later…', 'Move out of the goal', 'Don’t do'],
      cancel: ['Cancel', 'Keep'],
      condition: ['Allow', 'Keep'],
      triage: ['Do', 'Later…', 'Don’t do'],
    })
  })

  it('each write the option it names in the field answer', () => {
    const task = kindRecord(
      asked('task', [choice('drop', 'out', 'later', 'do'), text('until')]),
      word,
    )
    expect(task.answers.map((answer) => answer.answer)).toEqual([
      { answer: 'do' },
      { answer: 'later' },
      { answer: 'out' },
      { answer: 'drop' },
    ])
  })

  it('put off to the day or card in until, and ask first before they cancel work', () => {
    const goal = kindRecord(asked('goal', ASKED[3]?.[1] ?? []), word)
    expect(goal.answers.map(({ label, later, twoStep }) => ({ label, later, twoStep }))).toEqual([
      { label: 'Do', later: undefined, twoStep: undefined },
      { label: 'Later…', later: { field: 'until' }, twoStep: undefined },
      { label: 'Don’t do', later: undefined, twoStep: true },
    ])
    const cancel = kindRecord(asked('cancel', [choice('cancel', 'keep')]), word)
    expect(cancel.answers.map((answer) => answer.twoStep)).toEqual([true, undefined])
  })

  it('keep an option the server adds under its own label, after the known ones', () => {
    const review = kindRecord(asked('review', [choice('hold', 'accept', 'return')]), word)
    expect(review.answers.map((answer) => answer.label)).toEqual([
      'Accept',
      'Return to work',
      'server hold',
    ])
  })

  it('are none where the question has no field to answer them in: it stays a choice', () => {
    const odd = kindRecord(asked('review', [text('answer')]), word)
    expect({ kind: odd.kind, answers: odd.answers }).toEqual({ kind: 'choice', answers: [] })
    const plain = kindRecord(asked(null, [choice('a', 'b')]), word)
    expect({ kind: plain.kind, answers: plain.answers }).toEqual({ kind: 'choice', answers: [] })
  })
})
