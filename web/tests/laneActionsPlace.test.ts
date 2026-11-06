/**
 * Where a lane heading's actions stand, from widths alone. The widths are hand-made, in 64ths of
 * a pixel as the heading gives them: a line of 352px, a gap of 12px, actions of 80px, and the
 * state, the counts and a note of the sizes a phone's heading draws.
 */
import assert from 'node:assert/strict'

import { test } from 'vitest'

import { placeOf } from '@/widgets/work-item-views/utils/laneActionsPlace.ts'
import type { LaneLines } from '@/widgets/work-item-views/utils/laneActionsPlace.ts'

const px = (pixels: number) => pixels * 64

/** A phone's heading: the state, the counts and a note, a line of 352px. */
const phone: LaneLines = {
  actions: px(80),
  gap: px(12),
  line: px(352),
  parts: [px(60), px(120), px(100)],
  state: 0,
  wholeBeside: false,
}

test('the actions end the last line where they and their gap fit it, to the last 64th', () => {
  // 60 + 12 + 120 + 12 + 100 = 304, and 304 + 12 + 80 = 396 > 352: they do not fit after the
  // note. With the note 36px shorter, 268 + 12 + 80 = 360 still does not; 44px shorter it is
  // exactly 352, and a line filled exactly holds.
  assert.equal(placeOf({ ...phone, parts: [px(60), px(120), px(56)] }), 'end')
  assert.equal(placeOf({ ...phone, parts: [px(60), px(120), px(56) + 1] }), 'tied')
})

test('a note half a pixel too wide for the line is taken down with the actions', () => {
  // The case a heading once read the other way: the counts end at 260.5px, and 260.5 + 12 + 80
  // = 352.5 overflows a line of 352 that flex wraps.
  const parts = [px(60), px(188.5)]
  assert.equal(placeOf({ ...phone, parts, state: -1 }), 'tied')
  assert.equal(placeOf({ ...phone, parts: [px(60), px(188)], state: -1 }), 'end')
})

test('beside the title where it stays whole there, before taking anything down', () => {
  assert.equal(placeOf({ ...phone, wholeBeside: true }), 'beside')
  // Where the last line has room, they end it whatever the title would do beside them.
  assert.equal(placeOf({ ...phone, parts: [px(60)], wholeBeside: true }), 'end')
})

test('alone at the end where taking the last part down would leave the state alone', () => {
  // The state and the counts share the line; the counts and the actions would fit one.
  const parts = [px(60), px(200)]
  assert.equal(placeOf({ ...phone, parts, state: 0 }), 'end')
  // The same widths with no state shown: the counts go down with them.
  assert.equal(placeOf({ ...phone, parts: [px(60), px(200)], state: -1 }), 'tied')
})

test('alone at the end where the last part starts its line or does not fit one with them', () => {
  // The note starts the second line: 60 + 12 + 120 + 12 + 200 > 352.
  assert.equal(placeOf({ ...phone, parts: [px(60), px(120), px(300)] }), 'end')
  // The note follows the counts, but it and the actions are wider than a line: 270 + 12 + 80.
  assert.equal(placeOf({ ...phone, parts: [px(60), px(270)], state: -1 }), 'end')
})

test('a part wider than the line stands on a line of its own, and nothing follows it there', () => {
  assert.equal(placeOf({ ...phone, parts: [px(400)], state: -1 }), 'end')
  assert.equal(placeOf({ ...phone, parts: [px(400), px(40)], state: -1 }), 'end')
})
