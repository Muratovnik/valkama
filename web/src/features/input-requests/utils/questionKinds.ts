import { choiceRecord } from '@/features/input-requests/utils/questionRecord.ts'
import type {
  KindAnswer,
  QuestionKind,
  QuestionRecord,
} from '@/features/input-requests/utils/questionRecord.ts'

import type { InputRequestEntry } from '@/shared/api/inputRequestModel.ts'

/**
 * The kinds in the order the list offers them: a choice of options first, which every question
 * without a purpose is, then the kinds by the server's purpose.
 */
export const KIND_ORDER: readonly QuestionKind[] = [
  'choice',
  'review',
  'triage',
  'goal',
  'task',
  'condition',
  'cancel',
  'confirm',
  'return',
]

type Purpose = NonNullable<InputRequestEntry['request']['purpose']>

/**
 * The kind of each purpose the owner answers. The consent of the sessions a cancel stops is asked
 * of those sessions, not of the owner, so it has no kind of its own and reads as a choice.
 */
const KIND_OF: Partial<Record<Purpose, QuestionKind>> = {
  review: 'review',
  triage: 'triage',
  goal: 'goal',
  task: 'task',
  condition: 'condition',
  cancel: 'cancel',
  confirm: 'confirm',
  return: 'return',
}

/** The field a question with a purpose is answered in, and the one a put-off's day or item goes in. */
const ANSWER_FIELD = 'answer'
const UNTIL_FIELD = 'until'

/**
 * The server's answers of each kind, in the order its buttons stand. An answer the server adds
 * that is not here stands after them under the server's own label.
 */
const ANSWERS: Record<Exclude<QuestionKind, 'choice'>, readonly string[]> = {
  review: ['accept', 'return'],
  triage: ['do', 'later', 'drop'],
  goal: ['do', 'later', 'drop'],
  task: ['do', 'later', 'out', 'drop'],
  condition: ['allow', 'keep'],
  cancel: ['cancel', 'keep'],
  confirm: ['confirm', 'leave'],
  return: ['do', 'later', 'drop'],
}

/** The answers that cannot be taken back: each cancels work, so its first press only asks. */
const ASKS_FIRST = new Set(['cancel', 'drop'])

/** The kind a question is shown as: its purpose's, or a choice of options. */
export function kindOf(entry: InputRequestEntry): QuestionKind {
  const { purpose } = entry.request
  return (purpose && KIND_OF[purpose]) || 'choice'
}

/**
 * A question as the record of its kind, with the answers its buttons write. `word` names an
 * answer by its option id in the person's language. A question whose purpose names a kind but
 * that offers no field to answer it in stays a choice of options, which its form answers.
 */
export function kindRecord(
  entry: InputRequestEntry,
  word: (option: string) => string,
): QuestionRecord {
  const kind = kindOf(entry)
  const { fields } = entry.request
  const field = fields.find((candidate) => candidate.id === ANSWER_FIELD)
  if (kind === 'choice' || field?.type !== 'choice') return choiceRecord(entry)
  const until = fields.some((candidate) => candidate.id === UNTIL_FIELD)
  const order = ANSWERS[kind]
  const offered = [...field.options].sort((a, b) => rank(order, a.id) - rank(order, b.id))
  const answers = offered.map((option): KindAnswer => {
    const known = order.includes(option.id)
    return {
      label: known ? word(option.id) : option.label,
      answer: { [ANSWER_FIELD]: option.id },
      ...(option.id === 'later' && until ? { later: { field: UNTIL_FIELD } } : {}),
      ...(ASKS_FIRST.has(option.id) ? { twoStep: true as const } : {}),
    }
  })
  return { ...choiceRecord(entry), kind, answers }
}

/** Where an answer stands among its kind's, the unknown ones after all of them. */
function rank(order: readonly string[], option: string) {
  const at = order.indexOf(option)
  return at < 0 ? order.length : at
}
