/**
 * A claim answer says where it started the item, and a release where it put
 * the item back in the queue. The browser reads both answers through the strict
 * work-item contract, so an unknown field there would refuse the owner's own
 * claim; these hold the two fields to their shape.
 */

import { expect, test } from 'vitest'

import { validateWorkItemRecord } from '@/shared/api/planningModel.ts'

import { workItem } from './browser/planningFixtures.ts'

test('a claim that started the item and a release that requeued it both parse', () => {
  const started = validateWorkItemRecord({
    ...structuredClone(workItem),
    started: { from: 'backlog', to: 'dev' },
    warnings: ['MAIN-1 starts under a claim by user that no session confirmed'],
  })
  expect(started.started).toEqual({ from: 'backlog', to: 'dev' })
  const requeued = validateWorkItemRecord({
    ...structuredClone(workItem),
    requeued: { from: 'dev', to: 'todo' },
  })
  expect(requeued.requeued).toEqual({ from: 'dev', to: 'todo' })
})

test('a move without both ends, or with a field it does not have, is refused', () => {
  for (const started of [{ from: 'backlog' }, { from: 'backlog', to: 'dev', by: 'claim' }]) {
    expect(() => validateWorkItemRecord({ ...structuredClone(workItem), started })).toThrow()
  }
})
