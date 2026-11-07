/**
 * Whether the comment's press leads the place before a question's answers, from widths alone.
 * The widths are hand-made, in 64ths of a pixel as the row gives them: a row of 262px, a gap of
 * 8px, a press of 32px and the asking's room of 192px.
 */
import assert from 'node:assert/strict'

import { test } from 'vitest'

import { pressLeads } from '@/features/input-requests/utils/leadPlace.ts'
import type { LeadRow } from '@/features/input-requests/utils/leadPlace.ts'

const px = (pixels: number) => pixels * 64

const phone: LeadRow = {
  controlGap: px(8),
  controls: [px(90)],
  gap: px(8),
  line: px(262),
  press: px(32),
  room: px(192),
}

test('the press leads the place where it, the gap and the asking room fit, to the last 64th', () => {
  // 32 + 8 + max(90, 192) = 232 <= 262.
  assert.equal(pressLeads(phone), true)
  assert.equal(pressLeads({ ...phone, line: px(232) }), true)
  assert.equal(pressLeads({ ...phone, line: px(232) - 1 }), false)
})

test('the controls set the place where they are wider than the room', () => {
  // «Open task» and «Check status»: 90 + 8 + 110 = 208, and 32 + 8 + 208 = 248.
  const two = { ...phone, controls: [px(90), px(110)] }
  assert.equal(pressLeads(two), true)
  assert.equal(pressLeads({ ...two, line: px(248) - 1 }), false)
  // With no asking to keep room for, the controls alone count.
  assert.equal(pressLeads({ ...phone, room: 0, line: px(130) }), true)
})

test('a place of no control, or a row with no press, leads nothing', () => {
  assert.equal(pressLeads({ ...phone, controls: [] }), false)
  assert.equal(pressLeads({ ...phone, press: 0 }), false)
})
