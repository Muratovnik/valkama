/**
 * Where a lane heading's actions stand, from widths alone. The widths are hand-made, in sixty-fourths of
 * a pixel as the heading gives them: a line of 352px, a gap of 12px, actions of 80px, and the
 * state, the counts and a note of the sizes a phone's heading draws.
 */
import assert from 'node:assert/strict'

import { test } from 'vitest'

import { layoutOf, placeOf } from '@/widgets/work-item-views/utils/laneActionsPlace.ts'
import type { LaneHead, LaneLines } from '@/widgets/work-item-views/utils/laneActionsPlace.ts'

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

/** A short title's heading on a phone: the state and the counts below it, 60px left beside it. */
const short: LaneHead = {
  actions: px(80),
  first: px(60),
  gap: px(12),
  line: px(292),
  parts: [px(40), px(200)],
  state: 0,
  titleGap: px(8),
  wraps: true,
}

test('the state goes up beside a short title where the actions would otherwise stand alone', () => {
  // Below: 40 + 12 + 200 = 252 leaves no room for 12 + 80, and the counts cannot go down with
  // them without leaving the state alone, so they would take a third line. With the state beside
  // the title (12 + 40 <= 60), 200 + 12 + 80 = 292 fills the second line exactly.
  assert.deepEqual(layoutOf(short), { place: 'end', raised: true })
  // A pixel more of counts and the state going up saves nothing: the actions stand alone either
  // way, so it stays with the counts.
  assert.deepEqual(layoutOf({ ...short, parts: [px(40), px(200) + 1] }), {
    place: 'end',
    raised: false,
  })
})

test('the state stays with the counts where it does not fit beside the whole title', () => {
  assert.deepEqual(layoutOf({ ...short, first: px(52) - 1 }), { place: 'end', raised: false })
  assert.deepEqual(layoutOf({ ...short, first: px(52) }), { place: 'end', raised: true })
})

test('the state stays with the counts where going up saves no line', () => {
  // Everything after the title fits one line: 40 + 12 + 100 + 12 + 80 = 244.
  assert.deepEqual(layoutOf({ ...short, parts: [px(40), px(100)] }), {
    place: 'end',
    raised: false,
  })
  // On a line that does not wrap the state stays where it is whatever it would save.
  assert.deepEqual(layoutOf({ ...short, wraps: false }), { place: 'end', raised: false })
})

test('beside the title the actions need room after a state gone up as well', () => {
  // A note of 250 cannot end its line with the actions, the title stays whole beside them
  // (8 + 80 <= 100), so they stand there and the state stays below: going up, it would leave
  // 100 - 52 = 48, short of them, and the heading would take a line more.
  const wide = { ...short, first: px(100), parts: [px(40), px(200), px(250)] }
  assert.deepEqual(layoutOf(wide), { place: 'beside', raised: false })
})

test('a heading with no state shown has nothing to raise', () => {
  assert.deepEqual(layoutOf({ ...short, parts: [px(200)], state: -1 }), {
    place: 'end',
    raised: false,
  })
})
