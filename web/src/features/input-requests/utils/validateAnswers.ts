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
 * A field with options has one comment, whatever is chosen in it: the server still takes two
 * things, an own option in place of a choice and a note beside one, and which of them the words
 * are is decided when they are sent (`checkAnswers`), from what is chosen then. Two places to
 * write in one field asked the person to know that difference before writing.
 * `changing` is the revision of the answer being changed, null while no answer is: it
 * guards the write, so an answer that moved on under the form is a conflict and not
 * something overwritten. It lives here because the form has to survive what the draft
 * survives: a dialog closing and opening, and a card reading its questions again.
 */
export interface RequestDraft {
  answers: InputAnswers
  changing: number | null
  /** The comment of each field with options, by field id. */
  comments: Readonly<Record<string, string>>
  /** A comment on the whole question; it answers nothing. */
  note: string
}

export const EMPTY_DRAFT: RequestDraft = {
  answers: {},
  changing: null,
  comments: {},
  note: '',
}

const written = (map: Readonly<Record<string, string>>) =>
  Object.values(map).some((text) => text.trim() !== '')

/** Whether anything was typed or chosen in a draft, which is what "your draft is kept" promises. */
export function hasDraft(draft: RequestDraft | undefined): boolean {
  return (
    draft !== undefined &&
    (Boolean(draft.note.trim()) ||
      written(draft.comments) ||
      Object.values(draft.answers).some((value) => !blank(value)))
  )
}

/** A field's comment, trimmed; a text answer has none, being its author's words already. */
export function commentOn(draft: RequestDraft, field: InputRequestField): string {
  return field.type === 'text' ? '' : (draft.comments[field.id] ?? '').trim()
}

/** Whether a field's draft chooses anything: an option, Yes or No, a tick or a verdict. */
export const choosesIn = (draft: RequestDraft, field: string): boolean =>
  !blank(draft.answers[field])

/** One edit of one field: what it names changes, and what it leaves out stays. */
export interface FieldEdit {
  comment?: string
  value?: InputAnswers[string] | null
}

function editedAnswers(draft: RequestDraft, field: string, value: FieldEdit['value']) {
  if (value === undefined) return draft.answers
  const others = Object.entries(draft.answers).filter(([id]) => id !== field)
  return Object.fromEntries(value === null ? others : [...others, [field, value]])
}

/** A draft with one field edited. A null value takes the field's answer away. */
export function editField(draft: RequestDraft, field: string, edit: FieldEdit): RequestDraft {
  return {
    ...draft,
    answers: editedAnswers(draft, field, edit.value),
    comments:
      edit.comment === undefined ? draft.comments : { ...draft.comments, [field]: edit.comment },
  }
}

/**
 * What the last send refused that an edit has not touched. A field whose value or comment
 * changed is being put right, and its message goes: with nothing chosen, the comment is the
 * answer.
 */
export function stillRefused(
  refused: readonly string[],
  before: RequestDraft,
  after: RequestDraft,
): string[] {
  return refused.filter(
    (id) => before.answers[id] === after.answers[id] && before.comments[id] === after.comments[id],
  )
}

interface CheckedAnswers {
  fieldNotes: Record<string, string>
  own: Record<string, string>
  refused: string[]
  values: InputAnswers
}

/**
 * One field's part of the answer. Its comment goes as its own option while nothing is chosen
 * in it, which answers a required field, and as the note on what is chosen otherwise.
 */
function checkField(
  field: InputRequestField,
  draft: RequestDraft,
  checked: CheckedAnswers,
  list: boolean,
) {
  const { id } = field
  const comment = commentOn(draft, field)
  const value = draft.answers[id]
  const chosen = choosesIn(draft, id)
  if (comment) (chosen ? checked.fieldNotes : checked.own)[id] = comment
  if (value === undefined || !chosen) {
    if (list && field.type === 'multi_choice') checked.values[id] = []
    else if (field.required && !comment) checked.refused.push(id)
  } else if (validField(field, value)) checked.values[id] = value
  else checked.refused.push(id)
}

/**
 * The answer to send, and the fields that stop it, by id.
 *
 * Each refused field is named so its own message can stand beside it; a single
 * "fill in the required fields" at the foot of the form left the reader to find
 * which one it meant. A required field is answered by a value or, with nothing chosen, by its
 * comment, which then goes as its own option; the comment on the question answers nothing.
 * An empty optional field is left out.
 * With nothing chosen or written at all the first field is refused, required or not: an
 * answer with nothing in it tells the agent nothing. A question always has a field.
 *
 * A list under a comment (`list`) is the exception, by what its field is: its ticks are the
 * answer as they stand, and none ticked is one too, which the agent reads as not decided. So
 * its field sends `[]` rather than being left out, and nothing in it is refused for being empty.
 *
 * A field under another is answered only while it is shown. Hidden, its draft is kept for when
 * it shows again and nothing of it is sent, so it is never refused either.
 */
export function checkAnswers(
  fields: InputRequestField[],
  draft: RequestDraft,
  { list = false } = {},
): CheckedAnswers {
  const checked: CheckedAnswers = { fieldNotes: {}, own: {}, refused: [], values: {} }
  for (const field of fields)
    if (isShown(field, draft.answers)) checkField(field, draft, checked, list)
  const [first] = fields
  const empty =
    !Object.keys(checked.values).length &&
    !Object.keys(checked.own).length &&
    !Object.keys(checked.fieldNotes).length &&
    !draft.note.trim()
  if (first && !checked.refused.length && empty) checked.refused.push(first.id)
  return checked
}
