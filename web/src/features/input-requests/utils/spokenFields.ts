/**
 * A closed question's fields in the reader's words, where the service wrote them.
 *
 * A question with a purpose is composed by the service, its fields and their options in English:
 * «Answer», «Take it on», «Put it off». Its buttons already name each answer by the option's id
 * in the reader's language (`kindRecord`); the fold under an answered question names them the
 * same, so what was pressed reads as it was pressed. The fields a purpose's question has — the
 * answer, the day it is put off until, the list a cancel stops, the findings of a group and an
 * objection's reason — take their words by id. A session's consent is answered by an agent, and
 * reads in the same words. An option the catalogue has no word for, the findings an agent
 * listed, and every field of a question an agent composed stay as written.
 */
import type { InputRequestEntry, InputRequestField } from '@/shared/api/inputRequestModel.ts'

type Request = InputRequestEntry['request']
type Translate = (key: string) => string
type Knows = (key: string) => boolean

/** The fields the service gives a question with a purpose, which take their words by id. */
const FIELD_WORDS = new Set(['answer', 'until', 'cancels', 'items', 'reason'])
/** The field whose options are the answers, and the purpose whose answers are a session's. */
const ANSWER_FIELD = 'answer'
const CONSENT = 'consent'

function spokenField(
  field: InputRequestField,
  purpose: NonNullable<Request['purpose']>,
  t: Translate,
  te: Knows,
): InputRequestField {
  if (!FIELD_WORDS.has(field.id)) return field
  const label = t(`requests.kinds.fields.${field.id}`)
  if (field.id !== ANSWER_FIELD) return { ...field, label }
  const words = purpose === CONSENT ? 'requests.kinds.consentAnswers' : 'requests.kinds.answers'
  const options = field.options.map((option) => {
    const key = `${words}.${option.id}`
    return te(key) ? { ...option, label: t(key) } : option
  })
  return { ...field, label, options }
}

/** The question with the service's field and option words in the reader's language. */
export function spokenRequest(request: Request, t: Translate, te: Knows): Request {
  const { purpose } = request
  return purpose
    ? { ...request, fields: request.fields.map((field) => spokenField(field, purpose, t, te)) }
    : request
}
