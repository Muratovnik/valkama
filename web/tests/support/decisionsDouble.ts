/**
 * The server's summary of agent decisions as a test double: `GET /api/planning/decisions` over a
 * list of made-up decisions, narrowed as the server narrows them — by space, by project, by any of
 * the points named, by a period whose two ends are taken in — newest first, a page of `limit`
 * after `offset`, with how many there are in all. Each read's query is kept, so a test can say
 * what the page asked.
 */
import type { Decision } from '@/shared/api/decisionsApi.ts'
import { DECISION_POINTS } from '@/shared/api/planningDecisionPoints.ts'

/** The made-up session every decision of the double was taken in. */
const DECISION_SESSION = 'codex (session 0f0e0d0c-0b0a-4000-8000-000000000001)'

/**
 * `count` decisions, one a minute back from `newest`, the points taken in turn, on the cards
 * MAIN-1, MAIN-2 … of the project `alpha`, each newer one with a higher event id.
 */
export function decisionsBack(count: number, newest: Date): Decision[] {
  return Array.from({ length: count }, (_, index) => {
    const number = index + 1
    return {
      at: new Date(newest.getTime() - index * 60_000).toISOString().replace(/\.\d{3}Z$/u, 'Z'),
      point: DECISION_POINTS[index % DECISION_POINTS.length],
      item: {
        reference: `MAIN-${number}`,
        title: `Decided work ${number}`,
        space: 'MAIN',
        projects: ['alpha'],
      },
      session: DECISION_SESSION,
      what: `accepted MAIN-${number} under MAIN-${count + 1}`,
      event_id: count - index,
    }
  })
}

export function decisionsDouble(decisions: readonly Decision[]) {
  const asked: URLSearchParams[] = []

  function read(query: URLSearchParams) {
    asked.push(query)
    const space = query.get('space')
    const project = query.get('project')
    const points = query.getAll('point')
    const from = query.get('from')
    const to = query.get('to')
    const limit = Number(query.get('limit') ?? 50)
    const offset = Number(query.get('offset') ?? 0)
    const kept = decisions
      .filter((one) => space === null || one.item.space === space)
      .filter((one) => project === null || one.item.projects.includes(project))
      .filter((one) => !points.length || points.includes(one.point))
      .filter((one) => from === null || Date.parse(one.at) >= Date.parse(from))
      .filter((one) => to === null || Date.parse(one.at) <= Date.parse(to))
      .toSorted((one, other) => other.event_id - one.event_id)
    const items = kept.slice(offset, offset + limit)
    return { items, total: kept.length, has_more: offset + items.length < kept.length }
  }

  return { asked, read }
}
