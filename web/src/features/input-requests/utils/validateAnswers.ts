import { VERDICTS } from '@/shared/api/inputRequestModel.ts'
import type { InputAnswers, InputRequestField } from '@/shared/api/inputRequestModel.ts'

/** Whether a parent's answer holds an option: its verdict, its chosen option, or one of them. */
function holds(value: InputAnswers[string] | undefined, option: string): boolean {
  return Array.isArray(value) ? value.includes(option) : value === option
}

/**
 * Whether a field is shown, and so answered: always, unless it stands under another whose
 * answer does not hold its option. An own variant holds none, and has no value to hold it.
 */
export function isShown(field: InputRequestField, answers: InputAnswers): boolean {
  return !field.under || holds(answers[field.under.field], field.under.option)
}

function validField(field: InputRequestField, value: InputAnswers[string]): boolean {
  if (field.type === 'boolean') return typeof value === 'boolean'
  if (field.type === 'verdict')
    return typeof value === 'string' && (VERDICTS as readonly string[]).includes(value)
  if (field.type === 'text')
    return typeof value === 'string' && value.trim().length > 0 && value.length <= 8000
  const options = new Set(field.options.map((option) => option.id))
  return field.type === 'choice'
    ? typeof value === 'string' && options.has(value)
    : Array.isArray(value) &&
        new Set(value).size === value.length &&
        value.every((option) => options.has(option))
}

/** Whether a field's draft holds anything: an empty text or no ticks is not an answer begun. */
function blank(value: InputAnswers[string] | undefined): boolean {
  return value === undefined || value === '' || (Array.isArray(value) && value.length === 0)
}

/**
 * What is held in a question's form.
 *
 * An own variant is two facts, because taking its row back hides the editor and keeps the
 * words: `own` is what was written by field, `ownChosen` the fields whose row is chosen.
 * Only a chosen one is sent, and a chosen one with no words is refused at its own field.
 * `changing` is the revision of the answer being changed, null while no answer is: it
 * guards the write, so an answer that moved on under the form is a conflict and not
 * something overwritten. It lives here because the form has to survive what the draft
 * survives: a dialog closing and opening, and a card reading its questions again.
 */
export interface RequestDraft {
  answers: InputAnswers
  changing: number | null
  /** Comments on fields with options, by field id; each answers nothing. */
  fieldNotes: Readonly<Record<string, string>>
  /** A comment on the whole question; it answers nothing. */
  note: string
  own: Readonly<Record<string, string>>
  ownChosen: readonly string[]
}

export const EMPTY_DRAFT: RequestDraft = {
  answers: {},
  changing: null,
  fieldNotes: {},
  note: '',
  own: {},
  ownChosen: [],
}

const written = (map: Readonly<Record<string, string>>) =>
  Object.values(map).some((text) => text.trim() !== '')

/** Whether anything was typed or chosen in a draft, which is what "your draft is kept" promises. */
export function hasDraft(draft: RequestDraft | undefined): boolean {
  return (
    draft !== undefined &&
    (Boolean(draft.note.trim()) ||
      draft.ownChosen.length > 0 ||
      written(draft.own) ||
      written(draft.fieldNotes) ||
      Object.values(draft.answers).some((value) => !blank(value)))
  )
}

/** A chosen own variant's words, trimmed; empty when its row is not chosen or holds none. */
export function chosenOwn(draft: RequestDraft, field: string): string {
  return draft.ownChosen.includes(field) ? (draft.own[field] ?? '').trim() : ''
}

/** One edit of one field: what it names changes, and what it leaves out stays. */
export interface FieldEdit {
  note?: string
  own?: string
  ownChosen?: boolean
  value?: InputAnswers[string] | null
}

function editedAnswers(draft: RequestDraft, field: string, value: FieldEdit['value']) {
  if (value === undefined) return draft.answers
  const others = Object.entries(draft.answers).filter(([id]) => id !== field)
  return Object.fromEntries(value === null ? others : [...others, [field, value]])
}

function editedChosen(draft: RequestDraft, field: string, chosen: boolean | undefined) {
  if (chosen === undefined) return draft.ownChosen
  return [...draft.ownChosen.filter((id) => id !== field), ...(chosen ? [field] : [])]
}

/** A draft with one field edited. A null value takes the field's answer away. */
export function editField(draft: RequestDraft, field: string, edit: FieldEdit): RequestDraft {
  return {
    ...draft,
    answers: editedAnswers(draft, field, edit.value),
    ownChosen: editedChosen(draft, field, edit.ownChosen),
    own: edit.own === undefined ? draft.own : { ...draft.own, [field]: edit.own },
    fieldNotes:
      edit.note === undefined ? draft.fieldNotes : { ...draft.fieldNotes, [field]: edit.note },
  }
}

interface CheckedAnswers {
  fieldNotes: Record<string, string>
  own: Record<string, string>
  refused: string[]
  values: InputAnswers
}

function checkField(field: InputRequestField, draft: RequestDraft, checked: CheckedAnswers) {
  const { id } = field
  const own = chosenOwn(draft, id)
  const fieldNote = (draft.fieldNotes[id] ?? '').trim()
  if (fieldNote && field.type !== 'text') checked.fieldNotes[id] = fieldNote
  if (draft.ownChosen.includes(id) && !own) {
    checked.refused.push(id)
    return
  }
  if (own) checked.own[id] = own
  // An own variant takes the place of a single answer, and stands beside ticks.
  if (own && field.type !== 'multi_choice') return
  const value = draft.answers[id]
  if (value === undefined || blank(value)) {
    if (field.required && !own) checked.refused.push(id)
  } else if (validField(field, value)) checked.values[id] = value
  else checked.refused.push(id)
}

/**
 * The answer to send, and the fields that stop it, by id.
 *
 * Each refused field is named so its own message can stand beside it; a single
 * "fill in the required fields" at the foot of the form left the reader to find
 * which one it meant. A required field is answered by a value or by a chosen own variant;
 * a comment, on the field or on the question, answers nothing. An own variant chosen and
 * left empty is refused even where the field is optional or has ticks beside it, because
 * it was chosen and would otherwise vanish unsaid. An empty optional field is left out.
 * With nothing chosen or written at all the first field is refused, required or not: an
 * answer with nothing in it tells the agent nothing. A question always has a field.
 *
 * A field under another is answered only while it is shown. Hidden, its draft is kept for when
 * it shows again and nothing of it is sent, so it is never refused either.
 */
export function checkAnswers(fields: InputRequestField[], draft: RequestDraft): CheckedAnswers {
  const checked: CheckedAnswers = { fieldNotes: {}, own: {}, refused: [], values: {} }
  for (const field of fields) if (isShown(field, draft.answers)) checkField(field, draft, checked)
  const [first] = fields
  const empty =
    !Object.keys(checked.values).length &&
    !Object.keys(checked.own).length &&
    !Object.keys(checked.fieldNotes).length &&
    !draft.note.trim()
  if (first && !checked.refused.length && empty) checked.refused.push(first.id)
  return checked
}
