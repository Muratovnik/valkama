/**
 * The one way the app says how long and how long ago: the two largest units, each
 * counted whole, so a span never reads longer than it was and the second unit keeps
 * what the first leaves out. The expectations are counted by hand from the rule.
 */
import { describe, expect, it } from 'vitest'

import { agoWords, spanWords } from '@/shared/lib/timeSpan.ts'
import type { SpanWords } from '@/shared/lib/timeSpan.ts'

const words: SpanWords = {
  ago: (time) => `${time} ago`,
  days: (count) => `${count} d`,
  hours: (count) => `${count} h`,
  justNow: 'just now',
  lessThanMinute: 'under a minute',
  minutes: (count) => `${count} min`,
}

const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

describe('a span in its two largest units', () => {
  it.each([
    [59 * SECOND, 'under a minute'],
    [MINUTE, '1 min'],
    [59 * MINUTE + 59 * SECOND, '59 min'],
    [HOUR, '1 h'],
    [HOUR + 5 * MINUTE, '1 h 5 min'],
    [DAY - MINUTE, '23 h 59 min'],
    [DAY, '1 d'],
    [2 * DAY + 23 * HOUR + 15 * MINUTE, '2 d 23 h'],
    [3 * DAY - SECOND, '2 d 23 h'],
    [3 * DAY, '3 d'],
  ])('%i ms reads %s', (span, expected) => {
    expect(spanWords(span, words)).toBe(expected)
  })
})

describe('how long ago', () => {
  const now = Date.parse('2026-08-13T08:30:00Z')

  it('under a minute is just now, and a minute is a span', () => {
    expect(agoWords(now - 59 * SECOND, now, words)).toBe('just now')
    expect(agoWords(now - MINUTE, now, words)).toBe('1 min ago')
  })

  it('2.97 days is 2 days and 23 hours, neither 2 days nor 3', () => {
    expect(agoWords(Date.parse('2026-08-10T09:15:00Z'), now, words)).toBe('2 d 23 h ago')
  })
})
