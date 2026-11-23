/**
 * The rows of goals and stages asked for by id: `GET /api/planning/goal-volumes`, validated by the
 * strict contract in `volumesApi.ts`. Each is read whole, in the store this service writes; the
 * route takes 1 to 100 of them, so a longer list is asked for in as few reads as that allows.
 */
import { readJsonResponse } from '@/shared/api/readJsonResponse.ts'
import { validateGoalVolumesAnswer } from '@/shared/api/volumesApi.ts'

export type GoalVolumesRow = ReturnType<typeof validateGoalVolumesAnswer>[number]

/** The most goals one read takes. */
const GOAL_VOLUMES_MOST = 100

async function readSome(ids: readonly string[], signal?: AbortSignal) {
  const search = new URLSearchParams()
  for (const id of ids) search.append('id', id)
  const { response, payload } = await readJsonResponse(`/api/planning/goal-volumes?${search}`, {
    signal,
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return validateGoalVolumesAnswer(payload)
}

/** The rows of the goals and stages named, in the order named. */
export async function readGoalVolumes(
  ids: readonly string[],
  signal?: AbortSignal,
): Promise<GoalVolumesRow[]> {
  const parts: string[][] = []
  for (let start = 0; start < ids.length; start += GOAL_VOLUMES_MOST)
    parts.push(ids.slice(start, start + GOAL_VOLUMES_MOST))
  const answers = await Promise.all(parts.map((part) => readSome(part, signal)))
  return answers.flat()
}
