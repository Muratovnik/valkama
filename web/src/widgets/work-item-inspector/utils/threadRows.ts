import type { InputRequestEntry } from '@/shared/api/inputRequestModel.ts'
import type { WorkItem } from '@/shared/api/planningModel.ts'

export type ThreadComment = WorkItem['comments'][number]

/**
 * One thread of the discussion. A reply whose parent this card cannot read stands on its
 * own (`detached`): the questions come as a list that may be cut or fail, and what a
 * reply says is not lost with the question it answers.
 */
export type ThreadRow =
  | { comment: ThreadComment; key: string; kind: 'comment'; replies: ThreadComment[] }
  | { entry: InputRequestEntry; key: string; kind: 'question'; replies: ThreadComment[] }
  | { key: string; kind: 'detached'; replies: ThreadComment[] }

/** How fresh a thread is: its newest time, and its greatest comment id to break a tie. */
export interface ThreadPlace {
  id: number
  time: number
}

export type ThreadFilter = 'all' | 'unresolved'

function time(at: string | null) {
  const value = at === null ? Number.NaN : Date.parse(at)
  return Number.isNaN(value) ? Number.NEGATIVE_INFINITY : value
}

const isRoot = (comment: ThreadComment) =>
  comment.reply_to === null && comment.reply_to_request === null

function parentKey(reply: ThreadComment) {
  return reply.reply_to === null
    ? `question-${reply.reply_to_request ?? ''}`
    : `comment-${reply.reply_to}`
}

/** Every comment under its root and every reply under its parent, oldest reply first. */
export function threadGroups(
  comments: readonly ThreadComment[],
  questions: readonly InputRequestEntry[],
): ThreadRow[] {
  const replies = new Map<string, ThreadComment[]>()
  for (const comment of [...comments].sort((left, right) => left.id - right.id)) {
    if (isRoot(comment)) continue
    const key = parentKey(comment)
    replies.set(key, [...(replies.get(key) ?? []), comment])
  }
  const take = (key: string) => {
    const under = replies.get(key) ?? []
    replies.delete(key)
    return under
  }
  const rows: ThreadRow[] = [
    ...comments
      .filter((comment) => isRoot(comment))
      .map((comment): ThreadRow => {
        const key = `comment-${comment.id}`
        return { comment, key, kind: 'comment', replies: take(key) }
      }),
    ...questions.map((entry): ThreadRow => {
      const key = `question-${entry.request.request_id}`
      return { entry, key, kind: 'question', replies: take(key) }
    }),
  ]
  for (const [key, under] of replies) rows.push({ key, kind: 'detached', replies: under })
  return rows
}

/** Where the activity of a thread stands right now. */
function threadPlace(row: ThreadRow): ThreadPlace {
  const place = { id: 0, time: Number.NEGATIVE_INFINITY }
  if (row.kind === 'comment')
    Object.assign(place, { id: row.comment.id, time: time(row.comment.at) })
  if (row.kind === 'question') place.time = time(row.entry.request.created_at)
  for (const reply of row.replies) {
    place.id = Math.max(place.id, reply.id)
    place.time = Math.max(place.time, time(reply.at))
  }
  return place
}

/**
 * The places of this reading, keeping the one each thread already has. A thread stands
 * where its activity put it when it was first seen here, so a reply that arrives while
 * the card is open moves nothing from under the reader; a new thread is the freshest
 * there is and takes the top by itself, and a closed question read late takes its place
 * by its own time. The next opening of the card starts from `known` empty.
 */
export function keepThreadPlaces(
  rows: readonly ThreadRow[],
  known: ReadonlyMap<string, ThreadPlace>,
): Map<string, ThreadPlace> {
  const places = new Map(known)
  for (const row of rows) if (!places.has(row.key)) places.set(row.key, threadPlace(row))
  return places
}

/**
 * A reply came in since the thread took its place, written by someone else: what the
 * reader has just sent is no news to them.
 */
export function hasNewReply(row: ThreadRow, place: ThreadPlace | undefined) {
  return place !== undefined && row.replies.some((r) => r.id > place.id && r.by_person !== true)
}

const stillOpen = (row: ThreadRow, kept: ReadonlySet<string>) =>
  row.kind === 'question' &&
  (row.entry.request.status === 'pending' || kept.has(row.entry.request.request_id))

/**
 * The discussion as it reads: what still waits for an answer first, however old, and
 * every other thread under it by its activity, an entry with no recorded time last. The
 * questions arrive as a list, so this does not know where they are stored.
 *
 * `kept` names the questions that waited while this card was open. They stay up here
 * once answered: taking one to its place by time would move it from under the person
 * who has just answered it. The next opening of the card puts it by time.
 */
export function threadRows(
  rows: readonly ThreadRow[],
  kept: ReadonlySet<string>,
  places: ReadonlyMap<string, ThreadPlace>,
): ThreadRow[] {
  const placed = (row: ThreadRow) => places.get(row.key) ?? threadPlace(row)
  const freshest = (left: ThreadRow, right: ThreadRow) => {
    const [one, other] = [placed(left), placed(right)]
    return other.time - one.time || other.id - one.id
  }
  return [
    ...rows.filter((row) => stillOpen(row, kept)).sort(freshest),
    ...rows.filter((row) => !stillOpen(row, kept)).sort(freshest),
  ]
}

/**
 * How many threads there are, and how many the unresolved view keeps by their own standing:
 * a question counts as a thread, and while it waits as an open one. The count used to read
 * the comments alone, so «Unresolved 3» stood over four threads whenever a question waited.
 * What the view keeps for the reader's hands — a thread marked or answered while it stands,
 * a form still open — is not counted: it is settled, and stays only until the view changes.
 */
export function threadCounts(rows: readonly ThreadRow[]) {
  return {
    /** Threads that can carry the mark: the filter stands only where one does. */
    markable: rows.filter((row) => row.kind === 'comment').length,
    threads: rows.length,
    unresolved: rows.filter((row) => isUnresolved(row, NONE_KEPT)).length,
  }
}

const NONE_KEPT: ReadonlySet<string> = new Set()

/**
 * Whether the unresolved view shows a thread: a comment or report with no mark, a question
 * still open (a question's status is its mark), and a reply with nothing to read it under.
 */
export function isUnresolved(row: ThreadRow, kept: ReadonlySet<string>) {
  return row.kind === 'comment'
    ? row.comment.resolution === null
    : row.kind === 'detached' || stillOpen(row, kept)
}
