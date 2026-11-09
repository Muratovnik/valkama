import { isShown } from '@/features/input-requests/utils/validateAnswers.ts'

import type {
  InputAnswers,
  InputRequestEntry,
  InputRequestField,
  InputRequestOption,
} from '@/shared/api/inputRequestModel.ts'
import { plainText } from '@/shared/lib/richText.ts'

type Translate = (key: string, values?: Record<string, unknown>) => string
type Version = InputRequestEntry['request']['history'][number]

/** What a field offers to choose from: Yes and No are the options of a boolean. */
export function fieldOptions(
  field: InputRequestField,
  t: (key: string) => string,
): readonly InputRequestOption[] {
  if (field.type !== 'boolean') return field.options
  return [
    { id: 'true', label: t('requests.yes') },
    { id: 'false', label: t('requests.no') },
  ]
}

/**
 * A confirmed answer as the reader reads it: options by their labels, Yes or No for a boolean,
 * a verdict in the word it was given as.
 */
export function displayAnswer(
  field: InputRequestField,
  value: InputAnswers[string] | undefined,
  t: Translate,
) {
  if (typeof value === 'boolean') return t(value ? 'requests.yes' : 'requests.no')
  if (field.type === 'verdict' && typeof value === 'string')
    return t(`requests.review.said.${value}`)
  const label = (option: string) =>
    plainText(field.options.find((item) => item.id === option)?.label ?? option)
  if (Array.isArray(value)) return value.map((option) => label(option)).join(', ')
  if (typeof value !== 'string') return ''
  return field.type === 'choice' ? label(value) : plainText(value)
}

/**
 * A replaced answer as one line per field that said something: what was chosen, the own
 * variant, and the comment. It is the record of what stood, so it reads as plain words and
 * offers nothing; the answer in force is the one with the options around it.
 */
export function versionLines(
  fields: readonly InputRequestField[],
  version: Pick<Version, 'answers' | 'field_notes' | 'own'>,
  t: Translate,
): { id: string; text: string }[] {
  const said = (key: string, text: string | undefined) =>
    text ? t(key, { text: plainText(text) }) : ''
  return fields.flatMap((field) => {
    const parts = [
      displayAnswer(field, version.answers[field.id], t),
      said('requests.ownVariantSaid', version.own[field.id]),
      said('requests.fieldNoteSaid', version.field_notes[field.id]),
    ].filter(Boolean)
    return parts.length ? [{ id: field.id, text: `${field.label}: ${clauses(parts)}` }] : []
  })
}

/**
 * What a form had chosen when its question closed some other way, one line per field:
 * the options by their labels, and Yes or No. A comment is words, and so is a text field's
 * answer, so neither is here but among them (`unsentWords`).
 */
export function unsentChoices(
  fields: readonly InputRequestField[],
  draft: { answers: InputAnswers },
  t: Translate,
): string[] {
  return fields.flatMap((field) => {
    if (field.type === 'text' || !isShown(field, draft.answers)) return []
    const chosen = displayAnswer(field, draft.answers[field.id], t)
    return chosen ? [`${field.label}: ${chosen}`] : []
  })
}

/** A stop, a question mark or an ellipsis, with any closing quotes or brackets after it. */
const SENTENCE_END = /[.!?…]["'»”’)\]]*$/u

/**
 * Parts of one line, a semicolon between them. A part that ends its own sentence, as an own
 * variant or a comment in a person's words often does, is followed by the next as a new
 * sentence instead: a semicolon after its stop read as `.;`.
 */
function clauses([first = '', ...rest]: string[]) {
  let line = first
  for (const part of rest) {
    const sentence = `${part.charAt(0).toLocaleUpperCase()}${part.slice(1)}`
    line = SENTENCE_END.test(line) ? `${line} ${sentence}` : `${line}; ${part}`
  }
  return line
}
