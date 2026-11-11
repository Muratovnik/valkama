/**
 * What a system event's detail says to a reader.
 *
 * The server records a detail as a short machine line, and the history used to print it as
 * it stood: «5436: postponed» for a mark, «discovered-from from MAIN-7» for a link seen
 * from its far end, a request's UUID for a question. Those lines stay in the record, and
 * the search still reads them; what is shown are words for the events whose line has a
 * known shape, and the line itself for every other event. A change of labels names the
 * labels added and those taken off, not the two whole sets its detail records.
 *
 * A question is named by its title when the card has it: the card reads its questions for
 * the discussion anyway, so this costs no read. One the card has not read — older than the
 * newest the read brings, or a read that failed — says nothing beyond the row's title.
 */
import { mentionHistoryWords } from '@/widgets/work-item-inspector/utils/mentionLines.ts'
import type { MentionRecord } from '@/widgets/work-item-inspector/utils/mentionLines.ts'

import type { InputRequestEntry } from '@/shared/api/inputRequestModel.ts'
import type { WorkItem } from '@/shared/api/planningModel.ts'
import { LINK_KINDS } from '@/shared/api/planningModel.ts'
import { plainText } from '@/shared/lib/richText.ts'

type Translate = (key: string, values?: Record<string, unknown>) => string

interface RecordedEvent {
  detail: string
  action?: string
}

/** As much of a thread's first words as a line of history holds. */
const NAME_LENGTH = 60

const named = (words: string) =>
  words.length > NAME_LENGTH ? `${words.slice(0, NAME_LENGTH - 1).trimEnd()}…` : words

/** The thread a mark was set on or taken from, by its first words. */
function threadName(comments: WorkItem['comments'], id: number) {
  const root = comments.find((comment) => comment.id === id)
  if (!root) return null
  return named(plainText(root.report ? root.report.done : root.body))
}

/** The question an event's id names, by its title, when the card has read it. */
function questionWords(detail: string, questions: readonly InputRequestEntry[], t: Translate) {
  const asked = questions.find(({ request }) => request.request_id === detail.trim())
  return asked ? t('history.question', { question: named(asked.request.title) }) : ''
}

/** `5436: decision` or `5436`, as `resolve_work_item_comment` writes it. */
function markWords(detail: string, comments: WorkItem['comments'], t: Translate) {
  const [, id, decision] = /^(\d+)(?:: ([\s\S]*))?$/u.exec(detail) ?? []
  if (id === undefined) return detail
  const thread = threadName(comments, Number(id))
  if (thread === null) return t('history.threadGone')
  return decision
    ? t('history.threadDecided', { thread, decision })
    : t('history.thread', { thread })
}

/** `kind REF` on the item that made the link, `kind from REF` on the one it points at. */
function linkWords(detail: string, t: Translate) {
  const [, kind, from, reference] = /^([a-z-]+)( from)? (\S+)$/u.exec(detail) ?? []
  if (!kind || !reference || !(LINK_KINDS as readonly string[]).includes(kind)) return detail
  const side = from ? 'incoming' : 'outgoing'
  return `${t(['workItem.relation', kind, side].join('.'))} ${reference}`
}

const isLabelSet = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((label) => typeof label === 'string')

/** The labels of one set that the other lacks, each named in the reader's quotes. */
function labelList(labels: readonly string[], lacking: readonly string[], t: Translate) {
  return labels
    .filter((label) => !lacking.includes(label))
    .map((label) => t('history.labelName', { label }))
    .join(', ')
}

/** `{"from":[…],"to":[…]}`, as an edit that changed the labels writes it: which went, which came. */
function labelWords(detail: string, t: Translate) {
  let sets: unknown
  try {
    sets = JSON.parse(detail)
  } catch {
    return detail
  }
  const { from, to } = (sets ?? {}) as { from?: unknown; to?: unknown }
  if (!isLabelSet(from) || !isLabelSet(to)) return detail
  const added = labelList(to, from, t)
  const removed = labelList(from, to, t)
  const words = [
    added && t('history.labelsAdded', { labels: added }),
    removed && t('history.labelsRemoved', { labels: removed }),
  ].filter(Boolean)
  return words.length ? words.join(' · ') : detail
}

/** The name the reader sees for a state of the card's workflow by its key; null for none. */
type StateNamer = (key: string) => string | null

/**
 * `key` or `key: note`, as a transition writes it: the state named as everywhere else, by the
 * key's state in the card's workflow. A key the workflow no longer has, and a line of another
 * shape, read as recorded.
 */
function moveWords(detail: string, nameState: StateNamer) {
  const [, key, note] = /^([a-z][a-z0-9-]*)(?:: ([\s\S]*))?$/u.exec(detail) ?? []
  const name = key === undefined ? null : nameState(key)
  if (name === null) return detail
  return note === undefined ? name : `${name}: ${note}`
}

/** What the card already holds that names the things an event's line refers to. */
interface EventContext {
  comments: WorkItem['comments']
  t: Translate
  /** The records of texts naming this item that the card's read brought. */
  mentions?: readonly MentionRecord[]
  /** Names a transition's state; with none, the line stays as recorded. */
  nameState?: StateNamer
  questions?: readonly InputRequestEntry[]
}

export function eventWords(event: RecordedEvent, context: EventContext) {
  const { comments, t, questions = [], mentions = [], nameState = () => null } = context
  switch (event.action) {
    case 'transitioned': {
      return moveWords(event.detail, nameState)
    }
    case 'comment_resolved':
    case 'comment_reopened': {
      return markWords(event.detail, comments, t)
    }
    case 'linked':
    case 'unlinked': {
      return linkWords(event.detail, t)
    }
    // A question's id names nothing a reader can find here: its title does, when it is known.
    case 'request_created':
    case 'request_answered':
    case 'request_declined':
    case 'request_expired':
    case 'request_changed': {
      return questionWords(event.detail, questions, t)
    }
    // The detail is the id of a comment on another item, or `description:` and that item's
    // id: a bare number or id a reader cannot follow. The record of that comment names the
    // item, where the card's read brought it.
    case 'mentioned': {
      return mentionHistoryWords(event.detail, mentions, t)
    }
    // Both sets as JSON, which says nothing at a glance: the labels added and those taken off.
    case 'labels_changed': {
      return labelWords(event.detail, t)
    }
    default: {
      return event.detail
    }
  }
}
