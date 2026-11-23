/**
 * The records production-workspace-counts.spec.ts serves: the space of
 * `graphSpaceFrames.ts`, its two cards of another space among them, and enough open work beside
 * it that the counts line has three-figure numbers, the longest it says in a test.
 */
import { SPACE_READ, spaceModelWith } from '../servedAnswers.ts'
import type { Served } from '../servedContracts.ts'
import { identity, ITEMS, spaceFramesRead } from './graphSpaceFrames.ts'

/** How many open tasks stand beside the space's own records. */
const MORE = 120

/** The space's task under no goal, which each of them copies. */
const task = ITEMS.find((item) => item.reference === 'MAIN-1010')

const more = Array.from({ length: MORE }, (_, at) => {
  const n = 2000 + at
  return {
    ...task,
    work_item_id: identity(n),
    reference: `MAIN-${n}`,
    number: n,
    title: `Task ${n}`,
    parent_id: null,
  }
})

export const countsRead = () => spaceFramesRead([...ITEMS, ...more])

export const served: Served[] = [
  { name: 'served/workspaceCounts.ts', url: SPACE_READ, body: spaceModelWith(countsRead()) },
]
