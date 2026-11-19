/**
 * Which span a step line shows (`useStepSpan`), held to the rule the line states: the whole
 * window, from its start to its reset, running or past its reset alike; a frame narrows it to the
 * moments it covers, a frame with no length narrows nothing, and taking it back shows the whole
 * window again. The oracle is that rule on a week, its moments worked out by hand.
 */
import { describe, expect, it } from 'vitest'

import { useStepSpan } from '@/shared/ui/useStepSpan.ts'

const HOUR = 3_600_000
const DAY = 24 * HOUR
const FROM = Date.UTC(2030, 2, 4)
const TO = FROM + 7 * DAY

const spanOf = () => useStepSpan(() => ({ from: FROM, to: TO }))

describe('the span of a step line', () => {
  it('shows the whole window, start to reset, and nothing narrows it', () => {
    const span = spanOf()
    expect(span.shown.value).toEqual({ from: FROM, to: TO })
    expect(span.whole.value).toEqual({ from: FROM, to: TO })
    expect(span.framed.value).toBeNull()
  })

  it('narrows to a frame, and back to the whole window', () => {
    const span = spanOf()
    span.narrow({ from: FROM + DAY, to: FROM + 2 * DAY })
    expect(span.shown.value).toEqual({ from: FROM + DAY, to: FROM + 2 * DAY })
    expect(span.framed.value).toEqual({ from: FROM + DAY, to: FROM + 2 * DAY })
    span.back()
    expect(span.shown.value).toEqual({ from: FROM, to: TO })
    expect(span.framed.value).toBeNull()
  })

  it('narrows nothing for a frame with no length, or none', () => {
    const span = spanOf()
    span.narrow({ from: FROM + DAY, to: FROM + DAY })
    span.narrow(null)
    expect(span.shown.value).toEqual({ from: FROM, to: TO })
  })
})
