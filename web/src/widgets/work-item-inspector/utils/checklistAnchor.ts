import type { WorkItem } from '@/shared/api/planningModel.ts'

/**
 * How a checklist step a comment quotes stands now: still as quoted, changed
 * since, or gone. The composer asks it of the step being written about and the
 * thread of every step it quotes, so both say the same thing about one step.
 */
export function anchorState(
  item: WorkItem,
  id: string,
  text: string | null | undefined,
): 'changed' | 'current' | 'removed' {
  const step = item.checklist.find((entry) => entry.id === id)
  if (!step) return 'removed'
  return step.text === text ? 'current' : 'changed'
}
