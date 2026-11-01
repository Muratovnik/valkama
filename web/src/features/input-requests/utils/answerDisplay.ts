import type { InputAnswers, InputRequestField } from '@/shared/api/inputRequestModel.ts'

/** A confirmed answer as the reader reads it: options by their labels, Yes or No for a boolean. */
export function displayAnswer(
  field: InputRequestField,
  value: InputAnswers[string] | undefined,
  t: (key: string) => string,
): string {
  if (typeof value === 'boolean') return t(value ? 'requests.yes' : 'requests.no')
  const label = (option: string) =>
    field.options.find((item) => item.id === option)?.label ?? option
  if (Array.isArray(value)) return value.map((option) => label(option)).join(', ')
  if (typeof value !== 'string') return t('requests.noAnswer')
  return field.type === 'choice' ? label(value) : value
}
