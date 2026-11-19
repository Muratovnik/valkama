/**
 * Which span a step line shows and what its switch offers (`useStepSpan`), held to the rule the
 * line states: a running window opens on its start to now and a third of that past it, and the
 * switch offers that span beside the whole window only while it ends before the reset. The oracle
 * is that rule worked out by hand on a week: three quarters of it is 5 d 6 h, past which the span
 * to now and the forecast reaches the reset.
 */
import { describe, expect, it } from 'vitest'

import { useStepSpan } from '@/shared/ui/useStepSpan.ts'

const HOUR = 3_600_000
const DAY = 24 * HOUR
const FROM = Date.UTC(2030, 2, 4)
const TO = FROM + 7 * DAY
const WORDS = { ahead: 'To now and the forecast', whole: 'Whole window' }

/** A week read `elapsed` ms after its start, still running unless `ended`. */
const spanOf = (elapsed: number, ended = false) =>
  useStepSpan(
    () => ({ from: FROM, to: TO, end: FROM + elapsed, ended }),
    () => WORDS,
  )

const offered = (span: ReturnType<typeof spanOf>) => span.options.value.map(({ value }) => value)

describe('the span of a step line and its switch', () => {
  it('offers both spans on a week eleven hours in, and they differ', () => {
    const span = spanOf(11 * HOUR)
    expect(offered(span)).toEqual(['ahead', 'whole'])
    expect(span.switched.value).toBe(true)
    expect(span.chosen.value).toBe('ahead')
    // Eleven hours and a third of them past: 14 h 40 min from the start, well before the reset.
    expect(span.shown.value).toEqual({ from: FROM, to: FROM + 14 * HOUR + 40 * 60_000 })
    span.choose('whole')
    expect(span.shown.value).toEqual({ from: FROM, to: TO })
    expect(span.chosen.value).toBe('whole')
  })

  it('offers no span to now on a week six and a half days in: it shows the whole, with no switch', () => {
    const span = spanOf(6.5 * DAY)
    expect(offered(span)).toEqual(['whole'])
    expect(span.shown.value).toEqual({ from: FROM, to: TO })
    expect(span.switched.value).toBe(false)
    expect(span.chosen.value).toBe('whole')
  })

  it('offers no span to now at exactly three quarters, where it ends at the reset', () => {
    const span = spanOf(5 * DAY + 6 * HOUR)
    expect(offered(span)).toEqual(['whole'])
    expect(span.switched.value).toBe(false)
    // A minute earlier the span to now ends a minute and a third before the reset.
    const before = spanOf(5 * DAY + 6 * HOUR - 60_000)
    expect(offered(before)).toEqual(['ahead', 'whole'])
    expect(before.shown.value.to).toBe(TO - 80_000)
  })

  it('offers no span to now on a week its host says has reset', () => {
    const span = spanOf(11 * HOUR, true)
    expect(offered(span)).toEqual(['whole'])
    expect(span.switched.value).toBe(false)
    expect(span.shown.value).toEqual({ from: FROM, to: TO })
  })

  it('stands the switch while a frame narrows a week past three quarters, and takes it back', () => {
    const span = spanOf(6.5 * DAY)
    span.narrow({ from: FROM + DAY, to: FROM + 2 * DAY })
    expect(span.shown.value).toEqual({ from: FROM + DAY, to: FROM + 2 * DAY })
    expect(span.switched.value).toBe(true)
    expect(span.chosen.value).toBeNull()
    expect(offered(span)).toEqual(['whole'])
    span.choose('whole')
    expect(span.shown.value).toEqual({ from: FROM, to: TO })
    expect(span.switched.value).toBe(false)
  })
})
