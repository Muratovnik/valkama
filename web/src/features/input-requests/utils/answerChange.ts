import { hasDraft, isShown } from '@/features/input-requests/utils/validateAnswers.ts'
import type { RequestDraft } from '@/features/input-requests/utils/validateAnswers.ts'

import type { InputAnswers, InputRequestEntry } from '@/shared/api/inputRequestModel.ts'

type Request = InputRequestEntry['request']
type Value = InputAnswers[string] | undefined

/** The server keeps this many versions of an answer and refuses the next. */
export const ANSWER_VERSION_LIMIT = 50

/**
 * The words in a draft that are nowhere else once its question has closed some other way:
 * a text field's answer as well as the comments.
 */
export function unsentWords(request: Request, draft: RequestDraft): string {
  const answers = request.fields
    .filter((field) => field.type === 'text')
    .map((field) => draft.answers[field.id])
  return [
    ...answers.filter((value): value is string => typeof value === 'string'),
    draft.note,
    ...Object.values(draft.comments),
  ]
    .map((text) => text.trim())
    .filter(Boolean)
    .join('\n\n')
}

/**
 * Each field's comment as the answer in force says it: its own option or its note. An answer
 * of the time when a field took both, an own option beside ticks and a note, says both in one
 * comment, its own option first, so opening the form costs neither of them.
 */
function commentsOf(request: Request): Record<string, string> {
  const own = request.own ?? {}
  const notes = request.field_notes ?? {}
  return Object.fromEntries(
    [...new Set([...Object.keys(own), ...Object.keys(notes)])].map((id) => [
      id,
      [own[id], notes[id]].filter(Boolean).join('\n\n'),
    ]),
  )
}

/**
 * The form of a change: the answer in force, with the revision it was written against.
 * Words left over from when the question closed some other way join the comment, so that
 * opening the form does not cost the only copy of them.
 */
export function draftFromAnswer(request: Request, unsent = ''): RequestDraft {
  return {
    answers: request.answers ?? {},
    changing: request.revision,
    comments: commentsOf(request),
    note: [request.note ?? '', unsent].filter(Boolean).join('\n\n'),
  }
}

/** Ticks are a set, as the server compares them, and no ticks or no text are no value. */
function sameValue(left: Value, right: Value) {
  const read = (value: Value) =>
    Array.isArray(value) ? [...value].sort() : [value ?? ''].filter((part) => part !== '')
  return JSON.stringify(read(left)) === JSON.stringify(read(right))
}

/**
 * Whether a change's form says anything other than the answer in force, as the form opened on
 * it says it: what differs only in the spaces around it says the same. A field its parent hides
 * says nothing, whatever its draft still keeps for when it shows again.
 */
export function differsFromAnswer(request: Request, draft: RequestDraft): boolean {
  const comments = commentsOf(request)
  return (
    (request.note ?? '').trim() !== draft.note.trim() ||
    request.fields.some((field) => {
      const { id } = field
      const shown = isShown(field, draft.answers)
      return (
        !sameValue(request.answers?.[id], shown ? draft.answers[id] : undefined) ||
        (comments[id] ?? '').trim() !== (shown ? (draft.comments[id] ?? '') : '').trim()
      )
    })
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
