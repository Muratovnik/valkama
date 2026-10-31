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

/**
 * The answers to send, and the fields that stop them, by id.
 *
 * Each refused field is named so its own message can stand beside it; a single
 * "fill in the required fields" at the foot of the form left the reader to find
 * which one it meant. An empty optional field is left out of the answers.
 */
export function checkAnswers(
  fields: InputRequestField[],
  draft: InputAnswers,
): { refused: string[]; values: InputAnswers } {
  const values: InputAnswers = {}
  const refused: string[] = []
  for (const field of fields) {
    const value = draft[field.id]
    const empty =
      value === undefined || value === '' || (Array.isArray(value) && value.length === 0)
    if (empty) {
      if (field.required) refused.push(field.id)
      continue
    }
    if (validField(field, value)) values[field.id] = value
    else refused.push(field.id)
  }
  return { values, refused }
}
