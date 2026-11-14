import { isCommentList } from '@/features/input-requests/utils/requestIdentity.ts'
import { fillRecommended } from '@/features/input-requests/utils/reviewForm.ts'
import {
  checkAnswers,
  choosesIn,
  commentOn,
  editField,
  isShown,
} from '@/features/input-requests/utils/validateAnswers.ts'
import type { RequestDraft } from '@/features/input-requests/utils/validateAnswers.ts'

import type { InputAnswers, InputRequestEntry } from '@/shared/api/inputRequestModel.ts'

/**
 * A question as the list of everything waiting holds it: the question itself, what kind of
 * question it is, and where it was asked.
 *
 * The kind chooses what the record shows and how it is answered. A choice of options is answered
 * by its form and Send, as every question was before kinds; any other kind draws its own content
 * in the record's `subject` and is answered by a row of buttons (`answers`), each of which writes
 * through the same answer every question is written with. The record owns that write, its
 * history, a change of answer and what was left unsent; a kind repeats none of them.
 */
type QuestionKind =
  'acceptance' | 'cancel' | 'choice' | 'condition' | 'confirm' | 'goal' | 'return' | 'triage'

export interface QuestionRecord {
  /** Empty for a choice of options, which its form answers. */
  answers: readonly KindAnswer[]
  entry: InputRequestEntry
  kind: QuestionKind
  project: { id: string; title: string } | null
  /** Null while the listing does not say it; the head then says the place as it always has. */
  space: { key: string; name: string } | null
}

/**
 * One way to answer a question of a kind other than a choice: its words, and the values of the
 * question's fields it sends.
 */
export interface KindAnswer {
  answer: InputAnswers
  label: string
  /**
   * It puts the question off: its first press opens the choice of a day to come back to it, and
   * the day goes as the value of this text field of the question.
   */
  later?: { field: string }
  /** Its first press writes nothing and asks in place, as Don't answer does. */
  twoStep?: true
}

/** A question as the record of a choice of options, which is what every question is today. */
export function choiceRecord(entry: InputRequestEntry): QuestionRecord {
  return { entry, kind: 'choice', space: null, project: null, answers: [] }
}

/**
 * What one answer of a kind sends with what the form holds: its own values over the form's, and
 * no day another answer would put the question off to.
 */
export function kindAnswerDraft(
  answers: readonly KindAnswer[],
  index: number,
  draft: RequestDraft,
): RequestDraft {
  const chosen = answers[index]
  if (!chosen) return draft
  const others = new Set(
    answers.flatMap((answer) =>
      answer.later && answer !== chosen && answer.later.field !== chosen.later?.field
        ? [answer.later.field]
        : [],
    ),
  )
  const kept = Object.entries(draft.answers).filter(([id]) => !others.has(id))
  return { ...draft, answers: { ...Object.fromEntries(kept), ...chosen.answer } }
}

type Fields = InputRequestEntry['request']['fields']

/**
 * One pass over the choices still undecided that recommend an option: a single answer takes
 * the first it recommends, ticks take every one it does. What the person chose or wrote in a
 * field stays.
 */
function fillChoicesOnce(fields: Fields, draft: RequestDraft) {
  let next = draft
  let filled = 0
  for (const field of fields) {
    if (field.type !== 'choice' && field.type !== 'multi_choice') continue
    if (!isShown(field, next.answers) || choosesIn(next, field.id) || commentOn(next, field))
      continue
    const ids = field.options.filter((option) => option.recommended).map(({ id }) => id)
    const [first] = ids
    if (first === undefined) continue
    next = editField(next, field.id, { value: field.type === 'choice' ? first : ids })
    filled += 1
  }
  return { draft: next, filled }
}

/**
 * A draft with everything still undecided given what the agent recommends: the verdicts of a
 * review as its own press fills them (`fillRecommended`), and the options of a choice. A field
 * one of them opens is gone through again, so the passes go on while one fills anything.
 */
function recommendedDraft(fields: Fields, draft: RequestDraft) {
  let next = draft
  let filled = 0
  for (;;) {
    const verdicts = fillRecommended(fields, next)
    const choices = fillChoicesOnce(fields, verdicts.draft)
    const pass = verdicts.filled + choices.filled
    if (!pass) return { draft: next, filled }
    next = choices.draft
    filled += pass
  }
}

/** A question with what accepting its recommendation would send, filled over its draft. */
export interface RecommendedAnswer {
  draft: RequestDraft
  record: QuestionRecord
}

/**
 * The questions of a choice that their recommendation answers, and the rest.
 *
 * A question is answered by its recommendation when it waits, can be written, and filling what
 * it recommends over what the person already chose fills something and leaves nothing a send
 * would refuse. One whose recommendation leaves a required field empty, or that recommends
 * nothing, is among the rest: accepting would send nothing, or an answer the person never saw.
 */
export function recommendedAnswers(
  records: readonly QuestionRecord[],
  drafts: (record: QuestionRecord) => RequestDraft,
): { ready: RecommendedAnswer[]; rest: QuestionRecord[] } {
  const ready: RecommendedAnswer[] = []
  const rest: QuestionRecord[] = []
  for (const record of records) {
    if (record.kind !== 'choice') continue
    const { entry } = record
    const { fields, status } = entry.request
    const { draft, filled } = recommendedDraft(fields, drafts(record))
    const sendable =
      filled > 0 &&
      status === 'pending' &&
      entry.target.writable &&
      !checkAnswers(fields, draft, { list: isCommentList(entry) }).refused.length
    if (sendable) ready.push({ draft, record })
    else rest.push(record)
  }
  return { ready, rest }
}
