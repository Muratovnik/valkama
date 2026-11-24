/**
 * Where a centred dialog stands as what it holds changes (`heldOffset`, DESIGN.md «Dialogs and
 * drawers»): centred as it opens, then at the top it opened at while it grows or shrinks, raised
 * only by what would otherwise run past the room's foot, and never above the room's top.
 */
import { describe, expect, it } from 'vitest'

import { heldOffset } from '@/shared/ui/dialogHeldTop.ts'

describe('a centred dialog held at its top', () => {
  it('opens centred in its room', () => {
    expect(heldOffset(null, 860, 400)).toBe(230)
    expect(heldOffset(null, 860, 860)).toBe(0)
  })

  it('keeps that top as it grows while its foot stays in the room', () => {
    expect(heldOffset(230, 860, 443)).toBe(230)
    expect(heldOffset(230, 860, 630)).toBe(230)
  })

  it('keeps that top as it shrinks', () => {
    expect(heldOffset(230, 860, 300)).toBe(230)
  })

  it('rises only by what would run past the foot, and no higher than the room', () => {
    expect(heldOffset(230, 860, 700)).toBe(160)
    expect(heldOffset(230, 860, 900)).toBe(0)
  })
})
