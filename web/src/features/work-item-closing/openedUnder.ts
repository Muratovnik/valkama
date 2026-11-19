import { planningRefusal } from '@/shared/api/planningApi.ts'
import { splitIdentifiers } from '@/shared/lib/textReferences.ts'

/** The guard that refuses to complete a goal or a stage while work under it is open. */
const CHILDREN = '[children]'

/**
 * The work open under a goal or a stage whose close was refused for it, by reference, or null
 * when the refusal was for something else.
 *
 * A confirmation is refused this way when work opened under the goal while its window was open:
 * the goal is at work again, and there is nothing left to confirm. The refusal names up to five
 * of the open items after the goal's own reference (`MAIN-1 has 2 open item(s) under it: MAIN-3,
 * MAIN-4; …`), and those are the ones returned; an empty list is a refusal that named none.
 */
export function openedUnder(error: unknown, own: string): string[] | null {
  const refusal = planningRefusal(error)
  if (!refusal?.guards.includes('children')) return null
  const said = refusal.message.slice(refusal.message.indexOf(CHILDREN) + CHILDREN.length)
  // The guard's own words end where the next guard's name starts.
  const words = said.split(/; \[[a-z]/u)[0]
  return [
    ...new Set(
      splitIdentifiers(words).flatMap((run) =>
        typeof run === 'object' && run.kind === 'work-item' && run.value !== own ? [run.value] : [],
      ),
    ),
  ]
}
