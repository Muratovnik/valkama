import type { Executor } from '@/shared/api/executorModel.ts'
import type { WorkItemAgent } from '@/shared/api/planningModel.ts'
import { sessionStart } from '@/shared/lib/actor.ts'
import { agoWords, spanWords } from '@/shared/lib/timeSpan.ts'
import type { SpanWords } from '@/shared/lib/timeSpan.ts'

/** Enough of an agent's id to tell it from its siblings and to find it in a holder. */
const AGENT_ID_START = 8

/** The start of an agent's id, as its row and its run print it; a session prints its own. */
export const agentIdStart = (id: string) => id.slice(0, AGENT_ID_START)

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

interface AgentGroup {
  agents: WorkItemAgent[]
  /** What a press on the parent reaches; null where nothing opens it. */
  executor: Executor | null
  /** The parent session, as much of it as tells it from its siblings beside its whole id. */
  session: string
  /** Its start, as every surface prints a session (`sessionStart`). */
  shortSession: string
}

/**
 * The rows under the parent session each of them opens, in the order the read gives them:
 * the parent of the newest row first, and the rows of one parent as they came. A row with
 * no way to a session still stands with its parent, which it names on its own.
 */
export function agentsByParent(agents: readonly WorkItemAgent[]): AgentGroup[] {
  const groups = new Map<string, AgentGroup>()
  for (const agent of agents) {
    const session = agent.executor?.session || agent.session_id
    const group = groups.get(session) ?? {
      agents: [],
      executor: null,
      session,
      shortSession: sessionStart(session),
    }
    group.agents.push(agent)
    if (agent.executor?.session) group.executor = agent.executor
    groups.set(session, group)
  }
  return [...groups.values()]
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
  const shortId = agentIdStart(agent.agent_id)
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
