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
import {
  acceptedWords,
  childLeftWords,
  convertedWords,
  returnedWords,
  serviceNoteWords,
  splitWords,
  triageWords,
  untilWords,
} from '@/widgets/work-item-inspector/utils/workEventWords.ts'
import type { CountedTranslate } from '@/widgets/work-item-inspector/utils/workEventWords.ts'

import type { InputRequestEntry } from '@/shared/api/inputRequestModel.ts'
import type { WorkItem } from '@/shared/api/planningModel.ts'
import { LINK_KINDS } from '@/shared/api/planningModel.ts'
import { plainText } from '@/shared/lib/richText.ts'
import { standardState } from '@/shared/lib/stateNames.ts'
import type { NamedState } from '@/shared/lib/stateNames.ts'

type Translate = CountedTranslate

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

/** `5436: decision` or `5436`, as a resolved mark writes it. */
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
 * A transition's key named through the card's workflow; a key it does not hold, or a card read
 * with none, by the standard state of that key, so `ready` reads «Готово к работе» there too. A
 * key of neither stays unnamed.
 */
export function stateNamer(
  states: readonly NamedState[] | undefined,
  name: (state: NamedState) => string,
): StateNamer {
  return (key) => {
    const state = states?.find((one) => one.key === key) ?? standardState(key)
    return state ? name(state) : null
  }
}

/** A day or a time work is put off until, as the reader reads it. */
type DaySayer = (value: string) => string

/**
 * A transition's note in words where the service wrote it: `until X: why` for work put off,
 * `returned, date 2026-12-01` for work that came back. Any other note is the writer's own.
 */
function noteWords(note: string, t: Translate, day: DaySayer) {
  const said = untilWords(note, t, day) ?? serviceNoteWords(note, t)
  if (said !== null) return said
  const [, came] = /^returned, ([\s\S]+)$/u.exec(note) ?? []
  return came === undefined ? note : returnedWords(came, t, day)
}

/**
 * `key` or `key: note`, as a transition writes it: the state named as everywhere else, by the
 * key's state in the card's workflow, and the service's own note in words. A key no state is
 * named by, and a line of another shape, read as recorded.
 */
function moveWords(detail: string, nameState: StateNamer, t: Translate, day: DaySayer) {
  const [, key, note] = /^([a-z][a-z0-9-]*)(?:: ([\s\S]*))?$/u.exec(detail) ?? []
  const name = key === undefined ? null : nameState(key)
  if (name === null) return detail
  return note === undefined ? name : `${name}: ${noteWords(note, t, day)}`
}

/** What the card already holds that names the things an event's line refers to. */
interface EventContext {
  comments: WorkItem['comments']
  t: Translate
  /** Says a day work is put off until; with none, the day stays as recorded. */
  day?: DaySayer
  /** The records of texts naming this item that the card's read brought. */
  mentions?: readonly MentionRecord[]
  /** Names a transition's state; with none, the line stays as recorded. */
  nameState?: StateNamer
  questions?: readonly InputRequestEntry[]
}

export function eventWords(event: RecordedEvent, context: EventContext) {
  const { comments, t, questions = [], mentions = [], nameState = () => null } = context
  const { day = (value: string) => value } = context
  switch (event.action) {
    // Both name the state an item came to stand in by its key.
    case 'created':
    case 'transitioned': {
      return moveWords(event.detail, nameState, t, day)
    }
    // An acceptance, a return, a triage mark, a card leaving, a split and a change of kind:
    // what the service writes in their lines, in words; an agent's own words as written.
    case 'accepted': {
      return acceptedWords(event.detail, t)
    }
    case 'opened': {
      return serviceNoteWords(event.detail, t) ?? event.detail
    }
    case 'returned': {
      return returnedWords(event.detail, t, day)
    }
    case 'triage_seen': {
      return triageWords(event.detail, t)
    }
    case 'child_left': {
      return childLeftWords(event.detail, t)
    }
    case 'split_off': {
      return splitWords(event.detail, t)
    }
    case 'converted': {
      return convertedWords(event.detail, t)
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
