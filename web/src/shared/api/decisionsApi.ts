/**
 * What agents decided on their own: `GET /api/planning/decisions`, the marks a participation
 * point left on the events that recorded an agent's own decision, newest first.
 *
 * A read names its scope — a space by its key, narrowed to a project or not, or every space —
 * the points it keeps (every one when none is named) and its period, both ends taken in, as
 * moments with their offset. The server answers at most `DECISIONS_PAGE` marks a page, with how
 * many there are in all, so a long period is read page after page (`readDecisions`) rather than
 * with a larger page. Strict like every planning contract: a field nobody declared is refused.
 */

import { whatMessageSchema } from '@/shared/api/composedTextModel.ts'
import { boundedText, parseContract, positiveInt, strictObject, z } from '@/shared/api/contract.ts'
import { DECISION_POINTS } from '@/shared/api/planningDecisionPoints.ts'
import type { DecisionPoint } from '@/shared/api/planningDecisionPoints.ts'
import { WORK_ITEM_REFERENCE } from '@/shared/api/planningModel.ts'
import { SPACE_KEY, TITLE } from '@/shared/api/planningSpaceModel.ts'
import { enumField, invalid, ISO, PROJECT_ID } from '@/shared/api/platformApiGuards.ts'
import { readJsonResponse } from '@/shared/api/readJsonResponse.ts'

/** The most decisions the server answers in one page. */
const DECISIONS_PAGE = 200

const decisionSchema = strictObject({
  /** When the event that recorded the decision was written. */
  at: boundedText(ISO, 96),
  point: enumField(DECISION_POINTS),
  item: strictObject({
    reference: boundedText(WORK_ITEM_REFERENCE, 20),
    title: boundedText(TITLE, 200),
    space: boundedText(SPACE_KEY, 8),
    projects: z.array(boundedText(PROJECT_ID, 160)).max(100),
  }),
  /** Who decided: the session the call proved, named as a holder is, or the event's author. */
  session: z.string().min(1).max(512),
  /** What the point said was decided, up to 300 characters. */
  what: z.string().min(1).max(300),
  /**
   * The key and values `what` was composed of, which the interface says in the reader's
   * language; null on a mark written before keys. A record a test builds may leave it out.
   */
  what_message: whatMessageSchema.nullable().optional(),
  event_id: positiveInt(),
})

const pageSchema = strictObject({
  items: z.array(decisionSchema).max(DECISIONS_PAGE),
  total: positiveInt(true),
  has_more: z.boolean(),
})

export type Decision = z.infer<typeof decisionSchema>
type DecisionsPage = z.infer<typeof pageSchema>

/** What a read is narrowed by: a space's key and a project, points, and a period's two moments. */
export interface DecisionsQuery {
  from: string | null
  points: readonly DecisionPoint[]
  project: string | null
  space: string | null
  to: string | null
}

/** One page of the marks, or a refusal naming what does not fit the contract. */
export function validateDecisionsPage(payload: unknown): DecisionsPage {
  return parseContract(pageSchema, payload, 'planning.decisions', invalid)
}

/** The page of marks after the first `offset`. */
async function fetchDecisions(
  query: DecisionsQuery,
  offset: number,
  signal?: AbortSignal,
): Promise<DecisionsPage> {
  const search = new URLSearchParams()
  if (query.space !== null) search.set('space', query.space)
  if (query.project !== null) search.set('project', query.project)
  for (const point of query.points) search.append('point', point)
  if (query.from !== null) search.set('from', query.from)
  if (query.to !== null) search.set('to', query.to)
  search.set('limit', String(DECISIONS_PAGE))
  search.set('offset', String(offset))
  const { response, payload } = await readJsonResponse(`/api/planning/decisions?${search}`, {
    signal,
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return validateDecisionsPage(payload)
}

/**
 * Every decision of a read, page after page, newest first: each page as it lands goes to
 * `landed` with the decisions read so far and how many there are in all. Reading stops at
 * `most` decisions.
 */
export async function readDecisions(
  query: DecisionsQuery,
  options: {
    most: number
    signal?: AbortSignal
    landed: (read: { items: Decision[]; total: number }) => void
  },
): Promise<{ items: Decision[]; total: number }> {
  const items: Decision[] = []
  for (;;) {
    const page = await fetchDecisions(query, items.length, options.signal)
    items.push(...page.items)
    options.landed({ items: [...items], total: page.total })
    if (!page.has_more || page.items.length === 0 || items.length >= options.most)
      return { items, total: page.total }
  }
}
