/**
 * Which line of a list says less than the least its figure shows (`belowUnit`), by the units the
 * page writes a figure in: time in whole minutes, «under a minute» below one; a cost in cents,
 * «< $0.01» below one; tokens in whole tokens. Each measure is tried just under its unit and at
 * exactly one; a figure the measure has none of — no price, no token counted — is words, never
 * below a unit, and a cost that leaves tokens out says those tokens, so it is no empty line.
 */
import assert from 'node:assert/strict'

import { describe, test } from 'vitest'

import { belowUnit } from '@/pages/analytics/utils/usageFigures.ts'
import type { Spent } from '@/pages/analytics/utils/usageFigures.ts'

const spent = (given: Partial<Spent>): Spent => ({
  seconds: 0,
  tokens: null,
  cost: null,
  unpriced: 0,
  ...given,
})

describe('a line below the unit its figure is written in', () => {
  test('time: under a minute is below, a minute is not', () => {
    assert.equal(belowUnit('time', spent({ seconds: 0 })), true)
    assert.equal(belowUnit('time', spent({ seconds: 30 })), true)
    assert.equal(belowUnit('time', spent({ seconds: 59.9 })), true)
    assert.equal(belowUnit('time', spent({ seconds: 60 })), false)
    // A minute read back from hours on a chart's scale is a hair under one, and still a minute.
    assert.equal(belowUnit('time', spent({ seconds: (60 / 3600) * 3600 - 1e-9 })), false)
  })

  test('cost: under a cent is below, a cent is not, and no price is no figure to be below', () => {
    assert.equal(belowUnit('cost', spent({ cost: 0 })), true)
    assert.equal(belowUnit('cost', spent({ cost: 0.0099 })), true)
    assert.equal(belowUnit('cost', spent({ cost: 0.01 })), false)
    assert.equal(belowUnit('cost', spent({ cost: null, seconds: 60 })), false)
    // A cost that leaves tokens out says them beside it: that is something to read.
    assert.equal(belowUnit('cost', spent({ cost: 0.004, unpriced: 500 })), false)
  })

  test('tokens: none counted as nothing is below, one token is not, none counted at all is no figure', () => {
    assert.equal(belowUnit('tokens', spent({ tokens: 0 })), true)
    assert.equal(belowUnit('tokens', spent({ tokens: 1 })), false)
    assert.equal(belowUnit('tokens', spent({ tokens: null, seconds: 60 })), false)
  })
})
