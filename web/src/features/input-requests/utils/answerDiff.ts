import { displayAnswer } from '@/features/input-requests/utils/answerDisplay.ts'
import { rowName } from '@/features/input-requests/utils/reviewForm.ts'

import type { InputAnswers, InputRequestField } from '@/shared/api/inputRequestModel.ts'
import { plainText } from '@/shared/lib/richText.ts'

type Translate = (key: string, values?: Record<string, unknown>) => string
type Fields = readonly InputRequestField[]
type Value = InputAnswers[string] | undefined

/** One answer as the difference reads it: the stored parts, whichever version they are. */
export interface AnswerSide {
  answers: InputAnswers
  field_notes: Readonly<Record<string, string>>
  note: string | null
  own: Readonly<Record<string, string>>
}

/**
 * One row of what a change changed, by the contract's rule: the fields in their order, each
 * part that differs a row — its value, then its own variant, then its comment — and then the
 * comment on the whole question. A text a row quotes is null where it was removed.
 */
export type DiffRow =
  | { field: InputRequestField; part: 'comment' | 'own'; text: string | null }
  | { added: string[]; field: InputRequestField; part: 'options'; removed: string[] }
  | { field: InputRequestField; part: 'text' }
  | { field: InputRequestField; from: Value; part: 'value'; to: Value }
  | { field: null; part: 'note'; text: string | null }

const blank = (value: Value) => value === undefined || value === ''
const quoted = (text: string | undefined) => (text?.trim() ? text : null)

function valueRows(field: InputRequestField, from: Value, to: Value): DiffRow[] {
  if (field.type === 'multi_choice') {
    const before = new Set(Array.isArray(from) ? from : [])
    const after = new Set(Array.isArray(to) ? to : [])
    const order = field.options.map(({ id }) => id)
    const added = order.filter((id) => after.has(id) && !before.has(id))
    const removed = order.filter((id) => before.has(id) && !after.has(id))
    return added.length || removed.length ? [{ field, part: 'options', added, removed }] : []
  }
  if (field.type === 'text') return (from ?? '') === (to ?? '') ? [] : [{ field, part: 'text' }]
  if (blank(from) && blank(to)) return []
  return from === to ? [] : [{ field, part: 'value', from, to }]
}

export function answerDiff(fields: Fields, before: AnswerSide, after: AnswerSide): DiffRow[] {
  const rows = fields.flatMap((field): DiffRow[] => {
    const { id } = field
    const own = quoted(after.own[id])
    const comment = quoted(after.field_notes[id])
    return [
      ...valueRows(field, before.answers[id], after.answers[id]),
      ...(quoted(before.own[id]) === own ? [] : [{ field, part: 'own' as const, text: own }]),
      ...(quoted(before.field_notes[id]) === comment
        ? []
        : [{ field, part: 'comment' as const, text: comment }]),
    ]
  })
  const note = quoted(after.note ?? undefined)
  return quoted(before.note ?? undefined) === note
    ? rows
    : [...rows, { field: null, part: 'note', text: note }]
}

/** The contract quotes 60 characters at most, the last one an ellipsis. */
const QUOTE = 60
function cut(text: string) {
  const plain = plainText(text).replaceAll(/\s+/gu, ' ').trim()
  return plain.length > QUOTE ? `${plain.slice(0, QUOTE - 1)}…` : plain
}

function optionLabel(field: InputRequestField, id: string) {
  return plainText(field.options.find((option) => option.id === id)?.label ?? id)
}

/** A row in the person's words: labels in place of ids, verdicts in the words they were given as. */
export function diffText(fields: Fields, row: DiffRow, t: Translate): string {
  if (row.part === 'note')
    return row.text === null
      ? t('requests.review.diff.noteRemoved')
      : t('requests.review.diff.note', { text: cut(row.text) })
  const name = plainText(rowName(fields, row.field))
  if (row.part === 'value') {
    const word = (value: Value) => (blank(value) ? '—' : displayAnswer(row.field, value, t))
    return `${name} ${word(row.from)} → ${word(row.to)}`
  }
  if (row.part === 'options') {
    const marks = [
      ...row.added.map((id) => `+${optionLabel(row.field, id)}`),
      ...row.removed.map((id) => `−${optionLabel(row.field, id)}`),
    ]
    return `${name} ${marks.join(' ')}`
  }
  if (row.part === 'text') return t('requests.review.diff.rewritten', { field: name })
  const key = row.part === 'own' ? 'own' : 'comment'
  return row.text === null
    ? t(`requests.review.diff.${key}Removed`, { field: name })
    : t(`requests.review.diff.${key}`, { field: name, text: cut(row.text) })
}
