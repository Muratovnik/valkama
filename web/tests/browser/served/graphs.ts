/**
 * The graph specs' spaces, all of them the unit fixture's broad space: whole, with live
 * work on it, with references renamed long, or cut down to the work under no goal.
 */
import { WORK_ITEM_TREE } from '@/entities/work-item/utils/workTree.ts'

import type { LiveWork } from '@/shared/api/liveWorkModel.ts'

import { broadSpace, liveWorkFor } from '../../fixtures/graphSpaces.ts'
import { SPACE_READ, spaceModelWith } from '../servedAnswers.ts'
import type { Served } from '../servedContracts.ts'

/** The broad space's workflow, work and links, with this live work on it when given. */
export function broadRead(live?: Record<string, LiveWork>) {
  const { model } = broadSpace()
  return {
    workflow: model.workflow,
    work_items: model.work_items,
    links: model.links,
    ...(live ? { live_work: live } : {}),
  }
}

/** The broad space's live work; with `holder`, every live claim is held under that name. */
export function liveSpace(holder = '') {
  const { model } = broadSpace()
  const live = liveWorkFor(model)
  const items = holder
    ? model.work_items.map((item) =>
        item.work_item_id in live ? { ...item, claim_ref: holder } : item,
      )
    : model.work_items
  return { workflow: model.workflow, work_items: items, links: model.links, live_work: live }
}

/** Every other filed open item working, three unfiled ones too, one goal renamed `longest`. */
export function workingSpace(longest: string) {
  const { model } = broadSpace()
  const filed = model.work_items.filter((item) => !item.state?.is_terminal && item.parent_id)
  const unfiled = model.work_items.filter(
    (item) => !item.state?.is_terminal && !item.parent_id && !WORK_ITEM_TREE.isContainer(item),
  )
  const working = [...filed.filter((_, index) => index % 2 === 0), ...unfiled.slice(0, 3)]
  const live = Object.fromEntries(working.map((item) => [item.work_item_id, { state: 'working' }]))
  // The goal of the first worked-on item takes the longest reference.
  const renamed = working[0]?.parent_id
  const items = model.work_items.map((item) =>
    item.work_item_id === renamed ? { ...item, reference: longest } : item,
  )
  return { workflow: model.workflow, work_items: items, links: model.links, live_work: live }
}

/** Two cards the field draws at an overview's size, one working and one held, renamed long. */
export function overviewSpace(longest: readonly string[]) {
  const { model } = broadSpace()
  // Two the field draws as cards at this size, standing in an open frame.
  const drawn = (reference: string) => {
    const found = model.work_items.find((item) => item.reference === reference)
    if (!found) throw new Error(`the broad space holds ${reference}`)
    return found
  }
  const [working, held] = [drawn('MAIN-220'), drawn('MAIN-221')]
  const live: Record<string, LiveWork> = {
    [working.work_item_id]: { state: 'working' },
    [held.work_item_id]: { state: 'held' },
  }
  const items = model.work_items.map((item) => {
    if (item === working) return { ...item, reference: longest[0], claim_ref: 'an-agent' }
    if (item === held) return { ...item, reference: longest[1], claim_ref: 'an-agent' }
    return item
  })
  return { workflow: model.workflow, work_items: items, links: model.links, live_work: live }
}

/** The broad space with its open items being worked on, or as many as `working` that have lines. */
export function cometSpace(working = Number.POSITIVE_INFINITY) {
  const { model } = broadSpace()
  const linked = new Set(model.links.flatMap((link) => [link.from, link.to]))
  const open = model.work_items
    .filter(
      (item) => !item.state?.is_terminal && (working === Infinity || linked.has(item.work_item_id)),
    )
    .slice(0, working)
  const live: Record<string, LiveWork> = Object.fromEntries(
    open.map((item) => [item.work_item_id, { state: 'working' }]),
  )
  return { ...broadRead(), live_work: live }
}

/** Only open work under no goal, too much of it to start open. */
export function looseSpace() {
  const { model } = broadSpace()
  const loose = model.work_items
    .filter((item) => item.parent_id === null && !WORK_ITEM_TREE.isContainer(item))
    .filter((item) => !item.state?.is_terminal)
    .slice(0, 25)
  return { workflow: model.workflow, work_items: loose, links: [] }
}

/** The broad space's item linked only to its goal, and a working item under another goal. */
export function twoItems() {
  const { lone, model } = broadSpace()
  if (!lone) throw new Error('the broad space holds a lone item')
  const elsewhere = model.work_items.find(
    (item) =>
      !item.state?.is_terminal &&
      item.kind !== 'goal' &&
      item.parent_id !== null &&
      item.parent_id !== lone.goal.work_item_id,
  )
  if (!elsewhere) throw new Error('the broad space holds work under another goal')
  return { lone: lone.item, elsewhere }
}

const read = (name: string, change: object): Served => ({
  name: `served/graphs.ts ${name}`,
  url: SPACE_READ,
  body: spaceModelWith(change),
})

export const served: Served[] = [
  read('broadRead()', broadRead()),
  read('broadRead({})', broadRead({})),
  read('broadRead(liveWorkFor())', broadRead(liveWorkFor(broadSpace().model))),
  read(
    'broadRead(twoItems() working)',
    broadRead({
      [twoItems().elsewhere.work_item_id]: { state: 'working' },
    }),
  ),
  read('liveSpace()', liveSpace()),
  read('liveSpace(holder)', liveSpace('claude (session 3f2a9c1e-5b7d-4e2a-9c1f-0a1b2c3d4e5f)')),
  read('workingSpace()', workingSpace('WWWWWWWW-888888888')),
  read('overviewSpace()', overviewSpace(['WWWWWWWW-888888888', 'ABCDEFGH-123456789'])),
  read('cometSpace()', cometSpace()),
  read('cometSpace(1)', cometSpace(1)),
  read('looseSpace()', looseSpace()),
]
