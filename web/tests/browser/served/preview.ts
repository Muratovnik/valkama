/**
 * The space the hover card's specs read: the fixture's two items and one more to each
 * fact a preview shows, and the brief read that answers for each of them.
 */
import type { WorkItemBrief } from '@/shared/api/planningModel.ts'

import { boardId } from '../../fixtures/board.ts'
import { blockedWorkItem, doneState, planningReadModel } from '../planningFixtures.ts'
import { briefAnswer, cardRead, SPACE_READ } from '../servedAnswers.ts'
import type { Served } from '../servedContracts.ts'

export type Brief = (typeof planningReadModel.work_items)[number]

const blocked = planningReadModel.work_items[1] as Brief

/** An item of the space, by the number it reads as. */
export const held = (number: number, title: string, change: Partial<WorkItemBrief> = {}) =>
  ({
    ...blocked,
    work_item_id: boardId(number),
    reference: `MAIN-${number}`,
    number,
    title,
    ...change,
  }) as Brief

const STEP = (done: boolean, index: number) => ({
  id: boardId(500 + index),
  text: `Step ${index + 1}`,
  done,
  claimed_by: '',
  done_by: '',
  by_previous_holder: false,
})

/** What the open space holds besides the fixture's own two, one fact to each. */
export const SPACE: readonly Brief[] = [
  held(12, 'Keep the reader in place when a card closes', {
    claim_ref: 'claude (session f5f838f4-74fc-4a1b-9c2d-0123456789ab)',
    claim_state: 'live',
    checklist: [STEP(true, 0), STEP(false, 1), STEP(false, 2)],
    updated_at: '2026-11-03T22:40:00Z',
  } as Partial<WorkItemBrief>),
  held(13, 'Waits for the contract', { workable: false }),
  held(14, 'A closed one', {
    state: doneState,
    open: false,
    closed_at: '2026-11-02T18:05:00Z',
    last_claim_ref: 'claude',
  } as Partial<WorkItemBrief>),
  held(15, 'An abandoned claim', {
    claim_ref: 'codex (session 019e2b7c-5d1a-7c3e-9a10-0123456789ab)',
    claim_state: 'stale',
  } as Partial<WorkItemBrief>),
  held(16, 'Ж'.repeat(200), { kind: 'goal', priority: 'urgent' }),
]

const WAITING_LINK = {
  from: blockedWorkItem.work_item_id,
  to: boardId(13),
  kind: 'blocks',
  reference: blockedWorkItem.reference,
  is_terminal: false,
}

/** The space's read model with these items in it, as a read and a stream frame carry it. */
export const spaceModel = (items: readonly Brief[]) => ({
  ...structuredClone(planningReadModel),
  work_items: [...planningReadModel.work_items, ...items],
  links: [...planningReadModel.links, WAITING_LINK],
})

/** What a spec serves of `items`: the space's read and each item's brief read. */
export const servedSpace = (name: string, items: readonly Brief[]): Served[] => [
  { name: `${name}: space`, url: SPACE_READ, body: spaceModel(items) },
  ...items.map((item) => ({
    name: `${name}: brief ${item.reference}`,
    url: cardRead(item.reference, true),
    body: briefAnswer(item).json,
  })),
]

export const served: Served[] = servedSpace('served/preview.ts SPACE', SPACE)
