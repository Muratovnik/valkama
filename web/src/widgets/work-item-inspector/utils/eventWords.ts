/**
 * What a system event's detail says to a reader.
 *
 * The server records a detail as a short machine line, and the history used to print it as
 * it stood: «5436: postponed» for a mark, «discovered-from from MAIN-7» for a link seen
 * from its far end, a request's UUID for a question. Those lines stay in the record, and
 * the search still reads them; what is shown are words for the events whose line has a
 * known shape, and the line itself for every other event.
 */
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

/** The thread a mark was set on or taken from, by its first words. */
function threadName(comments: WorkItem['comments'], id: number) {
  const root = comments.find((comment) => comment.id === id)
  if (!root) return null
  const words = plainText(root.report ? root.report.done : root.body)
  return words.length > NAME_LENGTH ? `${words.slice(0, NAME_LENGTH - 1).trimEnd()}…` : words
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

export function eventWords(event: RecordedEvent, comments: WorkItem['comments'], t: Translate) {
  switch (event.action) {
    case 'comment_resolved':
    case 'comment_reopened': {
      return markWords(event.detail, comments, t)
    }
    case 'linked':
    case 'unlinked': {
      return linkWords(event.detail, t)
    }
    // A question's id names nothing a reader can find here: the title says what happened.
    case 'request_created':
    case 'request_answered':
    case 'request_declined':
    case 'request_expired':
    case 'request_changed': {
      return ''
    }
    default: {
      return event.detail
    }
  }
}
