import { chosenOwn, hasDraft } from '@/features/input-requests/utils/validateAnswers.ts'
import type { RequestDraft } from '@/features/input-requests/utils/validateAnswers.ts'

import type { InputAnswers, InputRequestEntry } from '@/shared/api/inputRequestModel.ts'

type Request = InputRequestEntry['request']
type Value = InputAnswers[string] | undefined

/** The server keeps this many versions of an answer and refuses the next. */
export const ANSWER_VERSION_LIMIT = 50

/**
 * The words in a draft that are nowhere else once its question has closed some other way:
 * a text field's answer as well as the own variants and the comments.
 */
export function unsentWords(request: Request, draft: RequestDraft): string {
  const answers = request.fields
    .filter((field) => field.type === 'text')
    .map((field) => draft.answers[field.id])
  return [
    ...answers.filter((value): value is string => typeof value === 'string'),
    draft.note,
    ...Object.values(draft.own),
    ...Object.values(draft.fieldNotes),
  ]
    .map((text) => text.trim())
    .filter(Boolean)
    .join('\n\n')
}

/**
 * The form of a change: the answer in force, with the revision it was written against.
 * Words left over from when the question closed some other way join the comment, so that
 * opening the form does not cost the only copy of them.
 */
export function draftFromAnswer(request: Request, unsent = ''): RequestDraft {
  const own = request.own ?? {}
  return {
    answers: request.answers ?? {},
    changing: request.revision,
    fieldNotes: request.field_notes ?? {},
    note: [request.note ?? '', unsent].filter(Boolean).join('\n\n'),
    own,
    ownChosen: Object.keys(own),
  }
}

/** Ticks are a set, as the server compares them, and no ticks or no text are no value. */
function sameValue(left: Value, right: Value) {
  const read = (value: Value) =>
    Array.isArray(value) ? [...value].sort() : [value ?? ''].filter((part) => part !== '')
  return JSON.stringify(read(left)) === JSON.stringify(read(right))
}

/**
 * Whether a change's form says anything other than the answer in force. A chosen own
 * variant says its words, and what differs only in the spaces around it says the same.
 */
export function differsFromAnswer(request: Request, draft: RequestDraft): boolean {
  return (
    (request.note ?? '').trim() !== draft.note.trim() ||
    request.fields.some(
      ({ id }) =>
        !sameValue(request.answers?.[id], draft.answers[id]) ||
        (request.own?.[id] ?? '').trim() !== chosenOwn(draft, id) ||
        (request.field_notes?.[id] ?? '').trim() !== (draft.fieldNotes[id] ?? '').trim(),
    )
  )
}

/**
 * Whether leaving a question would lose something: anything in a question still waiting,
 * a change that says something new, or words a closing left behind. A change's form seeded
 * with the answer in force holds nothing of its own until it differs. A choice a closing
 * left behind is said on the question, but it is no one's words to ask about keeping.
 */
export function holdsDraft(request: Request, draft: RequestDraft | undefined): boolean {
  if (!draft) return false
  if (draft.changing !== null) return differsFromAnswer(request, draft)
  return request.status === 'pending' ? hasDraft(draft) : Boolean(unsentWords(request, draft))
}
