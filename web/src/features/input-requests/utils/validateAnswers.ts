import type { InputAnswers, InputRequestField } from '@/shared/api/inputRequestModel.ts'

function validField(field: InputRequestField, value: InputAnswers[string]): boolean {
  if (field.type === 'boolean') return typeof value === 'boolean'
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

/** What is held in a question's form: the answers by field, and any words of one's own. */
export interface RequestDraft {
  answers: InputAnswers
  note: string
}

export const EMPTY_DRAFT: RequestDraft = { answers: {}, note: '' }

/** Whether anything was typed or chosen in a draft, which is what "your draft is kept" promises. */
export function hasDraft(draft: RequestDraft | undefined): boolean {
  return (
    Boolean(draft?.note.trim()) ||
    Object.values(draft?.answers ?? {}).some((value) => !blank(value))
  )
}

/**
 * The answers to send, and the fields that stop them, by id.
 *
 * Each refused field is named so its own message can stand beside it; a single
 * "fill in the required fields" at the foot of the form left the reader to find
 * which one it meant. An empty optional field is left out of the answers, and with
 * words of one's own in `note` no field is required any more. With nothing chosen or
 * written at all the first field is refused, required or not: an answer with nothing in it
 * tells the agent nothing and cannot be taken back. A question always has a field.
 */
export function checkAnswers(
  fields: InputRequestField[],
  draft: InputAnswers,
  note = '',
): { refused: string[]; values: InputAnswers } {
  const values: InputAnswers = {}
  const refused: string[] = []
  for (const field of fields) {
    const value = draft[field.id]
    if (blank(value)) {
      if (field.required && !note.trim()) refused.push(field.id)
      continue
    }
    if (validField(field, value)) values[field.id] = value
    else refused.push(field.id)
  }
  const [first] = fields
  if (first && !refused.length && !Object.keys(values).length && !note.trim())
    refused.push(first.id)
  return { values, refused }
}
