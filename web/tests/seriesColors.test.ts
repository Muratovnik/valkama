/**
 * The chart palette and who gets which of its hues.
 *
 * The palette is held to the checks a categorical chart palette owes (the `dataviz` method):
 * every pair a stack puts side by side — slot n beside slot n+1, and the neutral `other` beside
 * any slot — stays apart under protanopia and deuteranopia by an OKLab distance of 0.08 and under
 * ordinary vision by 0.15; each hue sits in the dark lightness band (OKLCH L 0.48–0.67) with
 * chroma 0.10 or more, and stands at 3:1 on every ground a chart lies on. The assignment is held
 * to its promise: a colour follows the name, whatever the order or the values.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { describe, test } from 'vitest'

import { SERIES_SLOT_COUNT, seriesSlots } from '@/shared/lib/seriesColors.ts'

import { apart, contrast, seen, token } from './paletteColors.ts'

const slots = Array.from({ length: SERIES_SLOT_COUNT }, (_, index) => index + 1)
const hue = (slot: number | 'other') => token(`--color-series-${slot}`)
const CHART_GROUNDS = ['--color-surface-recess', '--color-surface', '--color-surface-sheet']

describe('the assignment', () => {
  test('a name takes its slot from the names themselves, never from their order or their values', () => {
    const accounts = ['work', 'personal', 'ci', 'review']
    const given = seriesSlots(accounts)
    const reordered = seriesSlots([...accounts].reverse())
    const repeated = seriesSlots([...accounts, 'ci', 'work'])
    for (const name of accounts) {
      assert.equal(reordered.get(name), given.get(name), name)
      assert.equal(repeated.get(name), given.get(name), name)
    }
    assert.deepEqual(
      [...given],
      [
        ['ci', 1],
        ['personal', 2],
        ['review', 3],
        ['work', 4],
      ],
    )
  })

  test('the order is the names by code point, which no locale moves', () => {
    // A locale's collation puts «é» beside «e»; code points put it after «z».
    assert.deepEqual(
      [...seriesSlots(['zeta', 'éclair', 'alpha'])],
      [
        ['alpha', 1],
        ['zeta', 2],
        ['éclair', 3],
      ],
    )
  })

  test('slots are handed out in sequence, and a name past the last folds into the neutral', () => {
    const names = Array.from({ length: SERIES_SLOT_COUNT + 2 }, (_, index) => `s${index}`)
    const given = seriesSlots(names)
    assert.deepEqual(
      names.slice(0, SERIES_SLOT_COUNT).map((name) => given.get(name)),
      slots,
    )
    assert.deepEqual(
      names.slice(SERIES_SLOT_COUNT).map((name) => given.get(name)),
      ['other', 'other'],
    )
    assert.equal(seriesSlots([]).size, 0)
  })
})

describe('the palette', () => {
  test('every slot the assignment hands out is a token, and one fill rule draws each', () => {
    const fill = readFileSync(new URL('../src/shared/ui/seriesFill.css', import.meta.url), 'utf8')
    assert.match(fill, /\.series-fill \{\s*background: var\(--color-series-1\);/u)
    for (const slot of [...slots.slice(1), 'other'] as const) {
      hue(slot)
      const rule = new RegExp(
        String.raw`\[data-slot='${slot}'\] \{\s*background: var\(--color-series-${slot}\);`,
        'u',
      )
      assert.match(fill, rule, `no fill for slot ${slot}`)
    }
  })

  test('neighbours in a stack stay apart for every reader', () => {
    const pairs = slots.slice(1).map((slot) => [slot - 1, slot] as const)
    const besideOther = slots.map((slot) => [slot, 'other'] as const)
    for (const [first, second] of [...pairs, ...besideOther]) {
      for (const vision of ['protanopia', 'deuteranopia'] as const) {
        const distance = apart(hue(first), hue(second), vision)
        assert.ok(distance >= 0.08, `${first} and ${second}: ${distance.toFixed(3)} (${vision})`)
      }
      const distance = apart(hue(first), hue(second), 'ordinary')
      assert.ok(distance >= 0.15, `${first} and ${second}: ${distance.toFixed(3)} (ordinary)`)
    }
  })

  test('each hue is a colour of the dark band, not a grey, and reads as a mark on every ground', () => {
    for (const slot of slots) {
      const [lightness, a, b] = seen(hue(slot), 'ordinary')
      assert.ok(lightness >= 0.48 && lightness <= 0.67, `slot ${slot} L ${lightness.toFixed(3)}`)
      assert.ok(Math.hypot(a, b) >= 0.1, `slot ${slot} C ${Math.hypot(a, b).toFixed(3)}`)
    }
    for (const slot of [...slots, 'other'] as const)
      for (const ground of CHART_GROUNDS) {
        const ratio = contrast(hue(slot), token(ground))
        assert.ok(ratio >= 3, `slot ${slot} on ${ground} stands at ${ratio.toFixed(2)}:1`)
      }
  })

  test('no series is taken for a state', () => {
    for (const state of ['--color-danger', '--color-success', '--color-warning', '--color-info'])
      for (const slot of slots) {
        const distance = apart(hue(slot), token(state), 'ordinary')
        assert.ok(distance >= 0.035, `slot ${slot} and ${state}: ${distance.toFixed(3)}`)
      }
  })
})
