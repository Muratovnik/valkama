/**
 * The space the kind colours' specs read: a goal with a bug, an improvement and a
 * task under it, and the card each of them opens as.
 */
import type { WorkItemBrief } from '@/shared/api/planningModel.ts'

import { boardId } from '../../fixtures/board.ts'
import { planningReadModel, workItem } from '../planningFixtures.ts'
import { briefAnswer, cardRead, SPACE_READ, spaceModelWith } from '../servedAnswers.ts'
import type { Served } from '../servedContracts.ts'

export const KINDS = ['bug', 'goal', 'improvement', 'task'] as const
export type Kind = (typeof KINDS)[number]

type Brief = (typeof planningReadModel.work_items)[number]
const blocked = planningReadModel.work_items[1] as Brief

/** One item of the space, by the number it reads as. */
const held = (number: number, kind: Kind, change: Partial<WorkItemBrief> = {}) =>
  ({
    ...blocked,
    work_item_id: boardId(number),
    reference: `MAIN-${number}`,
    number,
    title: `A ${kind} to read`,
    kind,
    // Workable, so nothing is withheld: the row it copies is withheld as not ready.
    workable: true,
    withheld: [],
    claim_ref: '',
    claim_state: null,
    ...change,
  }) as Brief

export const GOAL = boardId(901)

/** The goal with a bug, an improvement and a task under it, and a loose goal on the board. */
const SPACE = [
  held(901, 'goal', { kind: 'goal' }),
  held(902, 'bug', { parent_id: GOAL }),
  held(903, 'improvement', { parent_id: GOAL }),
  held(904, 'task', { parent_id: GOAL }),
]

/** What the space's read lays over the fixture's model. */
export const KIND_SPACE = { work_items: SPACE, links: [] }

/** The card the item `reference` opens as, the goal for any other. */
export function kindCard(reference: string | null) {
  const brief = SPACE.find((item) => item.reference === reference) ?? (SPACE[0] as Brief)
  return briefAnswer({ ...workItem, ...brief, links: [] } as unknown as Brief)
}

export const served: Served[] = [
  { name: 'served/kindColors.ts KIND_SPACE', url: SPACE_READ, body: spaceModelWith(KIND_SPACE) },
  ...SPACE.map(({ reference }) => ({
    name: `served/kindColors.ts kindCard(${reference})`,
    url: cardRead(reference),
    body: kindCard(reference).json,
  })),
]
