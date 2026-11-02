/**
 * What an address of the form `/open/<number>` leads to, in the operator's terms.
 *
 * The server redirects an address that names a card before the app ever loads, so
 * the app normally sees only the ones that lead nowhere, and this says which of
 * them it is. It asks the mapped search, the finder's own path, because the search
 * names every source it read and every one it could not: that is what separates a
 * number nobody filed from a space that is not here and a store that cannot answer.
 */
import { searchGlobalPlanningWorkItems } from '@/shared/api/planningGlobalSearchApi.ts'
import { WORK_ITEM_REFERENCE } from '@/shared/api/planningModel.ts'
import { planningSpaceRoute, planningTargetRoute } from '@/shared/api/planningTarget.ts'
import type { PlatformRoute } from '@/shared/api/platformRoute.ts'
import { referenceSpaceKey } from '@/shared/lib/referenceLinks.ts'

export type WorkItemLinkAnswer =
  | { kind: 'found'; route: PlatformRoute }
  | { kind: 'malformed' }
  | { kind: 'no-item'; reference: string; space: string; spaceRoute: PlatformRoute }
  | { kind: 'no-space'; reference: string; space: string }
  | { kind: 'unreadable'; reference: string; space: string }

export async function readWorkItemLink(
  text: string,
  signal: AbortSignal,
): Promise<WorkItemLinkAnswer> {
  const reference = text.trim().toUpperCase()
  if (!WORK_ITEM_REFERENCE.test(reference)) return { kind: 'malformed' }
  const space = referenceSpaceKey(reference)
  const { items, coverage } = await searchGlobalPlanningWorkItems(reference, signal)
  const entry = items.find((candidate) => candidate.item.reference === reference)
  if (entry) return { kind: 'found', route: planningTargetRoute(entry.target) }
  // A binding to a space its store does not hold names no space at all.
  const sources = coverage.filter(
    (source) => source.space_ref.space_key === space && source.reason !== 'space_missing',
  )
  // A store that could not answer may hold the item, so nothing is said to be missing.
  if (sources.some((source) => source.status === 'unavailable'))
    return { kind: 'unreadable', reference, space }
  const [searched] = sources
  return searched
    ? {
        kind: 'no-item',
        reference,
        space,
        spaceRoute: planningSpaceRoute(searched.project_id, searched.space_ref),
      }
    : { kind: 'no-space', reference, space }
}
