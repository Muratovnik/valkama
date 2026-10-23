import { z } from 'zod'

import { WORK_ITEM_REFERENCE } from '@/shared/api/planningModel.ts'
import { readJsonResponse } from '@/shared/api/readJsonResponse.ts'

const resultSchema = z.object({
  work_item_id: z.uuid(),
  planning_space_id: z.uuid(),
  reference: z.string().max(20).regex(WORK_ITEM_REFERENCE),
  title: z.string().min(1).max(200),
  state: z.object({ name: z.string().min(1).max(200) }),
  claim_ref: z.string().max(200),
})

const searchSchema = z.object({
  interface_version: z.literal('valkama-planning-api'),
  work_items: z.array(resultSchema).max(50),
})

export type PlanningSearchResult = z.infer<typeof resultSchema>

export async function searchPlanningWorkItems(
  query: string,
  space: string,
  signal: AbortSignal,
): Promise<PlanningSearchResult[]> {
  const parameters = new URLSearchParams({ q: query, space, limit: '50' })
  const { response, payload } = await readJsonResponse(`/api/planning/search?${parameters}`, {
    signal,
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return searchSchema.parse(payload).work_items
}
