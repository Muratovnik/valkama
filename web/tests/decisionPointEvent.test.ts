/**
 * The `point` a history event carries when an agent's own decision marked it, read through
 * the card's own validator: a marked event parses with its point, a point the decision list
 * does not hold is refused, and an event no decision marked parses as it did before.
 */

import { describe, expect, it } from 'vitest'

import { validateWorkItemRecord } from '@/shared/api/planningModel.ts'

import { workItemFixture } from './fixtures/workItem.ts'

const identity = { state: 'confirmed', source: 'codex-meta', session_id: 's', agent_id: null }
const event = (extra: Record<string, unknown> = {}) => ({
  action: 'accepted',
  detail: 'accepted MAIN-12 under MAIN-3',
  author: 'codex',
  at: '2026-11-11T12:00:00.000000Z',
  identity,
  ...extra,
})
const card = (events: unknown[]) => ({ ...workItemFixture('Decisions', 5), events })

describe('a history event a decision marked', () => {
  it('is read with its point', () => {
    const read = validateWorkItemRecord(card([event({ point: 'proposed_goal' })]))
    expect(read.events.map((entry) => entry.point)).toEqual(['proposed_goal'])
  })

  it('is refused at a point the decision list does not hold', () => {
    expect(() => validateWorkItemRecord(card([event({ point: 'queue' })]))).toThrow()
  })

  it('is read without a point, as before', () => {
    const read = validateWorkItemRecord(card([event()]))
    expect(read.events).toHaveLength(1)
    expect('point' in read.events[0]).toBe(false)
  })
})
