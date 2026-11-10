/**
 * What a row of the side panel's list says in words: its second line, under the title, and
 * the sentence its hint and its accessible name say whole.
 *
 * The second line is what the session is doing, `working`, `asking` or `waiting`, then how
 * long, then after « · » where it belongs: the epic of an item, the folder of a session that
 * has a title of its own. How long counts from when the session began what it does now, in
 * whole minutes under an hour and whole hours from one, and says nothing under a minute. A
 * row that left the frame says that its work ended instead.
 *
 * The sentence says what the row is, where it belongs, the state with what it means, how long
 * and the agents on it: asking is a session stopped in the middle of a turn for a permission or
 * an answer, waiting is one whose turn is over, held is one at work on another item, and quiet
 * is one silent since a date.
 */
import type { ItemEntry, LiveEntry, SessionEntry } from '@/widgets/app-nav/utils/liveList.ts'

import type { LiveState } from '@/shared/api/liveWorkModel.ts'
import { liveSign } from '@/shared/lib/liveSign.ts'

const MINUTE = 60_000

/** The catalog's words through a component's own `t` and `d`, handed in so this stays pure. */
export interface Words {
  d: (value: Date, format: Record<string, string>) => string
  /** The item's workflow state as the owner names it (`useStateName`). */
  stateName: (row: ItemEntry['row']) => string
  t: (key: string, values?: Record<string, unknown>, plural?: number) => string
}

const QUIET_DAY = { month: 'short', day: '2-digit' } as const

/** How long since `since`, as the row says it; empty under a minute or with no time. */
function spanSince(t: Words['t'], since: string | null, now: number): string {
  if (since === null) return ''
  const minutes = Math.floor((now - Date.parse(since)) / MINUTE)
  if (Number.isNaN(minutes) || minutes < 1) return ''
  if (minutes < 60) return t('time.minutes', { count: minutes })
  return t('time.hours', { count: Math.floor(minutes / 60) })
}

interface Live {
  agents: number
  asks: boolean
  since: string | null
  state: LiveState | null
}

const liveOf = (entry: LiveEntry): Live => (entry.kind === 'item' ? entry.row : entry.session)

/** What a session on view is doing, in one word: working, asking or waiting. */
function doing(t: Words['t'], live: Live): string {
  const sign = liveSign(live.state, live.asks)
  return sign === null ? '' : t(`liveWork.doing.${sign}`)
}

/** Where a row belongs, as its second line ends: an item's epic, a titled session's folder. */
function context(entry: LiveEntry): string {
  if (entry.kind === 'item') return entry.epic ?? ''
  return entry.session.title === null ? '' : entry.session.folder
}

/**
 * A row's second line: the state, how long, and where it belongs. A row the frame dropped
 * keeps its last state only to keep its place while it fades; its line says that the work
 * ended, as its hint does, and never a state or a time that no longer runs.
 */
export function secondLine(t: Words['t'], entry: LiveEntry, now: number): string {
  const live = liveOf(entry)
  const state =
    entry.kind === 'item' && entry.row.fading
      ? t('liveWork.ended')
      : [doing(t, live), spanSince(t, live.since, now)].filter(Boolean).join(' ')
  return [state, context(entry)].filter(Boolean).join(' · ')
}

/** A session's name on its row: its title, else its folder, else that it has none. */
export function sessionTitle(t: Words['t'], entry: SessionEntry): string {
  return entry.session.title ?? (entry.session.folder || t('liveWork.unnamed'))
}

/** What the row is, and where it belongs. */
function subject(words: Words, entry: LiveEntry): string {
  const { t } = words
  if (entry.kind === 'item') {
    const { reference, title } = entry.row
    const own = `${reference} ${title}`
    return entry.epic ? `${own}, ${t('liveWork.partOf', { title: entry.epic })}` : own
  }
  const { folder, title } = entry.session
  if (title !== null && folder) return t('liveWork.sessionIn', { name: title, folder })
  if (title !== null) return t('liveWork.session', { name: title })
  return folder ? t('liveWork.sessionAt', { folder }) : t('liveWork.unnamed')
}

/** An item with no live work: pinned and idle, pinned and closed, or gone from the frame. */
function stillState({ stateName, t }: Words, entry: ItemEntry): string {
  const { row } = entry
  if (row.fading) return t('liveWork.ended')
  if (row.is_terminal && row.state === null) return t('liveWork.closed', { state: stateName(row) })
  return row.pinned ? t('liveWork.idle', { state: stateName(row) }) : ''
}

/** The state in words with what it means, and how long. */
function stateSentence(words: Words, entry: LiveEntry, now: number): string {
  const { d, t } = words
  const live = liveOf(entry)
  if (entry.kind === 'item' && (entry.row.fading || live.state === null))
    return stillState(words, entry)
  if (entry.kind === 'item' && entry.row.state === 'quiet' && entry.row.quiet_since)
    return t('liveWork.quiet', { since: d(new Date(entry.row.quiet_since), QUIET_DAY) })
  const sign = liveSign(live.state, live.asks)
  const span = spanSince(t, live.since, now)
  const state = span ? t('liveWork.during', { state: t(`liveWork.doing.${sign}`), span }) : ''
  return t(`liveWork.means.${sign}`, { state: state || t(`liveWork.doing.${sign}`) })
}

/**
 * The whole row in a sentence: what it is and where it belongs, then the state with what it
 * means and how long, then the agents on it.
 */
export function rowSentence(words: Words, entry: LiveEntry, now: number): string {
  const { t } = words
  const live = liveOf(entry)
  const fading = entry.kind === 'item' && entry.row.fading
  const agents =
    live.agents > 0 && !fading ? t('liveWork.agents', { count: live.agents }, live.agents) : ''
  const state = [stateSentence(words, entry, now), agents].filter(Boolean).join(', ')
  return state ? `${subject(words, entry)}: ${state}` : subject(words, entry)
}
