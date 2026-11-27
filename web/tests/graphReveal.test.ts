/**
 * The camera bringing the target the keyboard reached into sight: it stays for a target
 * in view, centres one out of it, and stands one longer than the field at its start.
 */
import { describe, expect, it } from 'vitest'

import { revealView } from '@/widgets/work-item-graph/utils/graphReveal.ts'

const field = { width: 390, height: 600 }
const margin = 16
const at = { x: 0, y: 0, zoom: 1 }
const box = (x: number, y: number, width: number, height: number) => ({
  x,
  y,
  width,
  height,
  frameId: 'frame',
})

describe('the camera revealing a target', () => {
  it('stays where it is for a target in view, clear of the edges', () => {
    expect(revealView(box(40, 40, 200, 80), at, field, margin)).toBeNull()
  })

  it('centres a target out of view that fits the field', () => {
    expect(revealView(box(1000, 900, 200, 80), at, field, margin)).toEqual({
      x: 390 / 2 - 1100,
      y: 600 / 2 - 940,
      zoom: 1,
    })
  })

  it('stands a target wider than the field at its start, its other axis centred', () => {
    const wide = box(1000, 900, 640, 80)
    const camera = revealView(wide, at, field, margin)
    expect(camera).toEqual({ x: margin - 1000, y: 600 / 2 - 940, zoom: 1 })
    // Once it stands there, the next press leaves the camera where it is.
    expect(camera && revealView(wide, camera, field, margin)).toBeNull()
  })

  it('reads the target at the zoom the operator chose', () => {
    const zoom = 0.5
    // 640 wide is 320 on the screen at this zoom, which fits: centred, not stood at its start.
    expect(revealView(box(1000, 900, 640, 80), { x: 0, y: 0, zoom }, field, margin)).toEqual({
      x: 390 / 2 - 1320 * zoom,
      y: 600 / 2 - 940 * zoom,
      zoom,
    })
  })

  it('stands a target taller than the field at its top', () => {
    expect(revealView(box(40, 2000, 200, 900), at, field, margin)).toEqual({
      x: 390 / 2 - 140,
      y: margin - 2000,
      zoom: 1,
    })
  })
})
