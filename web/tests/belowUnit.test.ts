/**
 * Which line of a list says less than the least its figure shows (`belowUnit`), by the units the
 * page writes a figure in: time in whole minutes, «under a minute» below one; a cost in cents,
 * «< $0.01» below one; tokens in whole tokens. Each measure is tried just under its unit and at
 * exactly one; a figure the measure has none of — no price, no token counted — is words, never
 * below a unit, and a cost that leaves tokens out says those tokens, so it is no empty line.
 * The same unit judges an entry of one period, an amount on a chart's scale (hours, tokens,
 * dollars), and a figure of the section's table, which then reads as none.
 */
import assert from 'node:assert/strict'

import { describe, test } from 'vitest'

import {
  belowUnit,
  drawnLines,
  entrySpent,
  unnamedEntries,
} from '@/pages/analytics/utils/usageFigures.ts'
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

const line = (key: string, seconds: number) => ({ key, spent: spent({ seconds }) })

describe('the lines a chart draws', () => {
  test('leave out every line under its unit, under any name, and keep one at the unit', () => {
    const lines = [line('big', 3600), line('half', 30), line('unknown', 59), line('minute', 60)]
    assert.deepEqual(
      drawnLines('time', lines).map((one) => one.key),
      ['big', 'minute'],
    )
  })

  test('keep every line where each is under its unit, so the chart is not empty', () => {
    const lines = [line('a', 20), line('b', 10)]
    assert.deepEqual(
      drawnLines('time', lines).map((one) => one.key),
      ['a', 'b'],
    )
  })
})

/** Seconds as a chart's scale holds them: hours. */
const hours = (seconds: number) => seconds / 3600

describe('the entries of one period that say nothing', () => {
  test('time: an amount above nothing and under a minute, never one at a minute or at nothing', () => {
    const amounts = {
      half: hours(30),
      hair: hours(59.9),
      minute: hours(60),
      big: hours(3600),
      nothing: 0,
    }
    assert.deepEqual(unnamedEntries('time', amounts), ['half', 'hair'])
  })

  test('cost and tokens: under a cent, under a token', () => {
    assert.deepEqual(unnamedEntries('cost', { tiny: 0.004, cent: 0.01 }), ['tiny'])
    assert.deepEqual(unnamedEntries('tokens', { some: 0.5, one: 1 }), ['some'])
  })

  test('an amount that leaves something out is said in words, so it is never one', () => {
    assert.deepEqual(unnamedEntries('cost', { tiny: 0.004, priced: 0.002 }, ['tiny']), ['priced'])
  })
})

describe('a figure of the section table as an entry says it', () => {
  test('under its unit it reads as none in that measure, and the other measures stay', () => {
    const half = spent({ seconds: 30, tokens: 5000, cost: 0.004 })
    assert.deepEqual(entrySpent('time', half), { ...half, seconds: 0 })
    assert.deepEqual(entrySpent('cost', half), { ...half, cost: 0 })
    assert.deepEqual(entrySpent('tokens', half), half)
  })

  test('at its unit it is the figure itself', () => {
    const minute = spent({ seconds: 60 })
    assert.equal(entrySpent('time', minute), minute)
  })
})
