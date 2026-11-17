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

test('a close that names commits no hook reported parses, each field to its shape', () => {
  const commit = {
    repository: 'alpha',
    hash: 'a'.repeat(40),
    subject: 'feat: by hand',
    committed_at: '2026-11-20T10:31:02+03:00',
  }
  const closed = validateWorkItemRecord({
    ...structuredClone(workItem),
    unreported_commits: [commit],
    unreported_total: 23,
    unreported_unread: ['beta'],
  })
  expect(closed.unreported_commits).toEqual([commit])
  expect(closed.unreported_total).toBe(23)
  expect(closed.unreported_unread).toEqual(['beta'])
  for (const named of [
    Array.from({ length: 21 }, () => commit),
    [{ ...commit, hash: 'a'.repeat(9) }],
    [{ ...commit, label: '' }],
  ]) {
    expect(() =>
      validateWorkItemRecord({ ...structuredClone(workItem), unreported_commits: named }),
    ).toThrow()
  }
})
