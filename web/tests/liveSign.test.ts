/**
 * The sign of what a session is doing: one per live state, a question for a wait that asks
 * a person, and none where there is no live work.
 */
import { describe, expect, it } from 'vitest'

import { liveSign } from '@/shared/lib/liveSign.ts'

describe('the sign of a live state', () => {
  it.each([
    ['working', false, 'working'],
    ['held', false, 'held'],
    ['waiting', false, 'waiting'],
    ['waiting', true, 'asks'],
    ['quiet', false, 'quiet'],
  ] as const)('draws %s (asks: %s) as %s', (state, asks, sign) => {
    expect(liveSign(state, asks)).toBe(sign)
  })

  it('reads a wait that does not say whether it asks as one that does not', () => {
    expect(liveSign('waiting')).toBe('waiting')
  })

  // `asks` is false for every state but waiting by contract; a stray one changes nothing.
  it.each(['working', 'held', 'quiet'] as const)('keeps %s whatever asks says', (state) => {
    expect(liveSign(state, true)).toBe(state)
  })

  it('draws nothing for no live work', () => {
    expect(liveSign(null)).toBeNull()
    expect(liveSign(undefined, true)).toBeNull()
  })
})
