import { boundedText, strictObject, z } from '@/shared/api/contract.ts'
import {
  PRIORITIES,
  STATE_CATEGORIES,
  WORK_ITEM_KINDS,
  WORK_ITEM_REFERENCE,
} from '@/shared/api/planningModel.ts'
import { planningCoverageSchema, planningTargetSchema } from '@/shared/api/planningTarget.ts'
import { enumField } from '@/shared/api/platformApiGuards.ts'
import { readJsonResponse } from '@/shared/api/readJsonResponse.ts'

const resultSchema = strictObject({
  target: planningTargetSchema,
  item: strictObject({
    work_item_id: z.uuid(),
    planning_space_id: z.uuid(),
    reference: boundedText(WORK_ITEM_REFERENCE, 18),
    title: z.string().min(1).max(200),
    // The marks a result row draws; a server that predates them sends none.
    kind: enumField(WORK_ITEM_KINDS).optional(),
    priority: enumField(PRIORITIES).optional(),
    state: strictObject({
      name: z.string().min(1).max(200),
      category: enumField(STATE_CATEGORIES).optional(),
      is_terminal: z.boolean().optional(),
    }),
    claim_ref: z.string().max(200),
  }),
}).refine((result) => result.target.reference === result.item.reference, {
  message: 'Search result does not match its target',
})

const searchSchema = strictObject({
  interface_version: z.literal('valkama-planning-search'),
  query: z.string().max(200),
  limit: z.number().int().min(1).max(100),
  has_more: z.boolean(),
  items: z.array(resultSchema).max(100),
  coverage: z.array(planningCoverageSchema).max(10_000),
}).refine((result) => result.items.length <= result.limit, {
  message: 'Search result exceeds its requested limit',
})

export type GlobalPlanningSearch = z.infer<typeof searchSchema>

/**
 * The refusals that stop the whole search rather than one source, by the code
 * the server names them with. Anything else is an ordinary failed request.
 */
const SEARCH_REFUSALS = new Set(['project_registry_unavailable', 'planning_binding_invalid'])
const refusalSchema = z.object({ error: z.object({ message: z.string() }) })

function refusal(response: Response, payload: unknown): Error {
  const parsed = refusalSchema.safeParse(payload)
  const reason = parsed.success ? parsed.data.error.message : ''
  return Object.assign(new Error(`HTTP ${response.status}`), {
    code: SEARCH_REFUSALS.has(reason) ? reason : 'request_failed',
    status: response.status,
  })
}

export async function searchGlobalPlanningWorkItems(
  query: string,
  signal: AbortSignal,
): Promise<GlobalPlanningSearch> {
  const parameters = new URLSearchParams({ q: query, limit: '50' })
  const { response, payload } = await readJsonResponse(
    `/api/modules/planning/search?${parameters}`,
    {
      signal,
    },
  )
  signal.throwIfAborted()
  if (!response.ok) throw refusal(response, payload)
  const result = searchSchema.parse(payload)
  if (result.query !== query || result.limit !== 50) throw new Error('Search response mismatch')
  return result
}
