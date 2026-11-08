/**
 * A summary's friction, read through the card's strict validator: the server returns it
 * beside `done`, `next` and `why`, as text of at most 4000 characters, and a summary
 * without it is what it always was. The card is the server's own answer (`card.json`).
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { validatePlanningWorkItemPayload } from '@/shared/api/platformPlanningPayload.ts'

const card = fileURLToPath(new URL('./fixtures/server/card.json', import.meta.url))

/** The real card with a summary of its own, as a report made current writes it. */
function withSummary(summary: Record<string, unknown>): unknown {
  const value = JSON.parse(readFileSync(card, 'utf8')) as {
    state: { payload: { work_item: Record<string, unknown> } }
  }
  value.state.payload.work_item.summary = summary
  return value
}
function summaryOf(value: unknown) {
  const { state } = validatePlanningWorkItemPayload(value)
  if (state.status !== 'ready') throw new Error('the card is not ready')
  return state.payload.work_item.summary
}

describe('a summary’s friction', () => {
  it('is read beside done, next and why, and a summary without it reads as before', () => {
    const summary = { done: 'Shipped', next: 'Nothing', why: 'Cheaper', friction: 'none' }
    expect(summaryOf(withSummary(summary))).toEqual(summary)
    expect(summaryOf(withSummary({ done: 'Shipped', next: 'Nothing' }))).toEqual({
      done: 'Shipped',
      next: 'Nothing',
    })
  })

  it('is refused when it is no text or longer than the server takes', () => {
    for (const friction of [5, null, 'f'.repeat(4001)]) {
      expect(() =>
        validatePlanningWorkItemPayload(withSummary({ done: 'D', next: 'N', friction })),
      ).toThrow()
    }
  })
})
