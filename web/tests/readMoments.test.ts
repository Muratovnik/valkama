/**
 * A record the store wrote in UTC is said at the browser's offset, so its clock time is the one
 * the time axis reads: 23:18 UTC is 02:18 the next day three hours east.
 */
import assert from 'node:assert/strict'

import { describe, test } from 'vitest'

import { dayOf, momentAtOffset, named } from '@/pages/analytics/utils/readMoments.ts'

describe('a moment at an offset', () => {
  test('says an instant at an offset east of UTC, across midnight', () => {
    const at = Date.parse('2026-11-11T23:18:40Z')
    const moment = momentAtOffset(at, 180)
    assert.equal(moment, '2026-11-12T02:18:40+03:00')
    // The read's own reading of it names that wall clock and that day.
    assert.equal(named(moment).toISOString().slice(11, 16), '02:18')
    assert.equal(dayOf(moment), '2026-11-12')
    assert.equal(Date.parse(moment), at)
  })

  test('says an instant at an offset west of UTC, and at one of half an hour', () => {
    const at = Date.parse('2026-11-11T02:05:00Z')
    assert.equal(momentAtOffset(at, -300), '2026-11-10T21:05:00-05:00')
    assert.equal(momentAtOffset(at, 330), '2026-11-11T07:35:00+05:30')
  })

  test("takes the browser's own offset at that instant when none is given", () => {
    const at = Date.parse('2026-11-11T23:18:00Z')
    const local = new Date(at)
    const clock = named(momentAtOffset(at)).toISOString().slice(11, 16)
    const [hours, minutes] = [local.getHours(), local.getMinutes()].map((part) =>
      String(part).padStart(2, '0'),
    )
    assert.equal(clock, `${hours}:${minutes}`)
  })
})
