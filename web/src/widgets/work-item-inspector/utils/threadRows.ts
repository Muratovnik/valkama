import type { InputRequestEntry } from '@/shared/api/inputRequestModel.ts'
import type { WorkItem } from '@/shared/api/planningModel.ts'

type ThreadComment = WorkItem['comments'][number]

export type ThreadRow =
  | { comment: ThreadComment; key: string; kind: 'comment' }
  | { entry: InputRequestEntry; key: string; kind: 'question' }

function time(at: string | null) {
  const value = at === null ? Number.NaN : Date.parse(at)
  return Number.isNaN(value) ? Number.NEGATIVE_INFINITY : value
}

const stands = (row: ThreadRow) =>
  row.kind === 'comment' ? time(row.comment.at) : time(row.entry.request.created_at)

/** Newest first; an entry with no recorded time goes last, where its age puts it. */
const newestFirst = (left: ThreadRow, right: ThreadRow) =>
  stands(right) - stands(left) ||
  (right.kind === 'comment' ? right.comment.id : 0) -
    (left.kind === 'comment' ? left.comment.id : 0)

/**
 * The discussion as it reads: what still waits for an answer first, however old, and
 * every comment and closed question under it by time. The questions arrive as a list,
 * so this does not know where they are stored.
 *
 * `kept` names the questions that waited while this card was open. They stay up here
 * once answered: taking one to its place by time would move it from under the person
 * who has just answered it. The next opening of the card puts it by time.
 */
export function threadRows(
  comments: readonly ThreadComment[],
  questions: readonly InputRequestEntry[],
  kept: ReadonlySet<string>,
): ThreadRow[] {
  const rows: ThreadRow[] = [
    ...comments.map((comment): ThreadRow => ({
      comment,
      key: `comment-${comment.id}`,
      kind: 'comment',
    })),
    ...questions.map((entry): ThreadRow => ({
      entry,
      key: `question-${entry.request.request_id}`,
      kind: 'question',
    })),
  ]
  const isUp = (row: ThreadRow) =>
    row.kind === 'question' &&
    (row.entry.request.status === 'pending' || kept.has(row.entry.request.request_id))
  return [
    ...rows.filter((row) => isUp(row)).sort(newestFirst),
    ...rows.filter((row) => !isUp(row)).sort(newestFirst),
  ]
}
