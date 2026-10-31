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

export function validateAnswers(
  fields: InputRequestField[],
  draft: InputAnswers,
): InputAnswers | null {
  const values: InputAnswers = {}
  for (const field of fields) {
    const value = draft[field.id]
    const empty =
      value === undefined || value === '' || (Array.isArray(value) && value.length === 0)
    if (empty) {
      if (field.required) return null
      continue
    }
    if (!validField(field, value)) return null
    values[field.id] = value
  }
  return values
}
