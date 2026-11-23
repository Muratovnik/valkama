import type { PlanningSpaceRef } from '@/shared/api/platformPlanningRefs.ts'
import { readJsonResponse } from '@/shared/api/readJsonResponse.ts'
/**
 * The Volumes read asked for one view: `GET /api/planning/volumes` with its scope, its period
 * and the filter of its tasks, validated by the strict contract in `volumesApi.ts`.
 *
 * A space is named exactly as the shell names it, by its store and key, and may be narrowed to a
 * project; every space is the global scope. The period's ends are days of the reader's calendar,
 * the last one not taken in, read at the reader's offset from UTC.
 */
import { validateVolumesAnswer } from '@/shared/api/volumesApi.ts'

export type Volumes = ReturnType<typeof validateVolumesAnswer>
export type VolumesGoal = Volumes['goals'][number]
export type VolumesSpent = VolumesGoal['spent']

/** The kinds of a task, which a filter keeps any of. */
export const TASK_KINDS = ['task', 'bug', 'improvement'] as const
export type TaskKind = (typeof TASK_KINDS)[number]

export interface VolumesQuery {
  /** The first day of the period, `2030-03-04`, from its midnight. */
  from: string
  kinds: readonly TaskKind[]
  labels: readonly string[]
  /** The project the space is narrowed to; null for the whole space. */
  project: string | null
  /** The space read; null for every space. */
  space: PlanningSpaceRef | null
  /** The day after the last one, whose midnight the period stops at. */
  to: string
  /** The reader's offset from UTC, in minutes, east positive. */
  utcOffset: number
}

/** The read of one view, or a refusal naming what does not fit the contract. */
export async function readVolumes(query: VolumesQuery, signal?: AbortSignal): Promise<Volumes> {
  const search = new URLSearchParams()
  if (query.space === null) search.set('scope_kind', 'global')
  else {
    search.set('scope_kind', 'space')
    search.set('data_scope_id', query.space.data_scope_id)
    search.set('space_key', query.space.space_key)
    if (query.project !== null) search.set('project_id', query.project)
  }
  search.set('from', query.from)
  search.set('to', query.to)
  search.set('utc_offset', String(query.utcOffset))
  for (const kind of query.kinds) search.append('kind', kind)
  for (const label of query.labels) search.append('label', label)
  const { response, payload } = await readJsonResponse(`/api/planning/volumes?${search}`, {
    signal,
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return validateVolumesAnswer(payload)
}
