import type { WorkItemAgent } from '@/shared/api/planningModel.ts'
import { agoWords, spanWords } from '@/shared/lib/timeSpan.ts'
import type { SpanWords } from '@/shared/lib/timeSpan.ts'

/** How many rows a folded list shows: a parent can have dozens of agents on one item. */
export const AGENTS_SHOWN = 3

/** Enough of an agent's id to tell it from its siblings and to find it in a holder. */
const SHORT_ID = 8

/** The catalog's words and the locale's dates, handed in so this stays pure. */
export interface TimeWords extends SpanWords {
  clock: (date: Date) => string
  day: (date: Date) => string
  year: (date: Date) => string
}

interface AgentMoment {
  /** The stored time, for `<time datetime>`. */
  at: string
  /** With its date whatever the distance, for the tooltip. */
  full: string
  /** As short as the distance from today lets it be. */
  text: string
}

interface AgentFacts {
  /** The last sign of activity after the start, when there is one and no end. */
  activity: AgentMoment | null
  /** How long ago that was. */
  ago: string
  /** From the start to the end or to the last sign: never to now, which nothing shows. */
  elapsed: string
  ended: AgentMoment | null
  /** How long ago it started, when nothing since says more. */
  quiet: string
  shortId: string
  started: AgentMoment
}

function shortMoment(date: Date, today: Date, words: TimeWords): string {
  if (date.toDateString() === today.toDateString()) return words.clock(date)
  return date.getFullYear() === today.getFullYear() ? words.day(date) : words.year(date)
}

function moment(at: string, now: number, words: TimeWords): AgentMoment {
  const date = new Date(at)
  return { at, full: words.year(date), text: shortMoment(date, new Date(now), words) }
}

/**
 * What one row says about an agent's time, and no more than the record shows.
 *
 * An end is said only when one was recorded. Without one, the last sign of
 * activity is what there is, and an agent that gave none since its start says that
 * instead of a span of no length that would read as having just begun.
 */
export function agentFacts(agent: WorkItemAgent, now: number, words: TimeWords): AgentFacts {
  const start = agent.started_at ?? agent.last_activity_at ?? ''
  const startAt = Date.parse(start)
  const lastAt = Date.parse(agent.last_activity_at ?? start)
  const started = moment(start, now, words)
  const shortId = agent.agent_id.slice(0, SHORT_ID)
  const ended = agent.ended_at ? moment(agent.ended_at, now, words) : null
  if (agent.ended_at !== null) {
    return {
      shortId,
      started,
      quiet: '',
      ended,
      activity: null,
      ago: '',
      elapsed: spanWords(Date.parse(agent.ended_at) - startAt, words),
    }
  }
  if (lastAt <= startAt) {
    return {
      shortId,
      started,
      quiet: agoWords(startAt, now, words),
      ended: null,
      activity: null,
      ago: '',
      elapsed: '',
    }
  }
  return {
    shortId,
    started,
    quiet: '',
    ended: null,
    activity: moment(agent.last_activity_at ?? start, now, words),
    ago: agoWords(lastAt, now, words),
    elapsed: spanWords(lastAt - startAt, words),
  }
}
