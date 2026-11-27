/**
 * The camera bringing the target the keyboard reached into sight, each axis on its own:
 * it stays along an axis the target is in view along, centres it along one it is not,
 * and stands one longer than the field at its start.
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
    // Down, it stands at 450 to 490 of 600: in view, so the camera stays along that axis.
    expect(revealView(box(1000, 900, 640, 80), { x: 0, y: 0, zoom }, field, margin)).toEqual({
      x: 390 / 2 - 1320 * zoom,
      y: 0,
      zoom,
    })
  })

  it('stands a target taller than the field at its top, and stays along the axis it is in view', () => {
    expect(revealView(box(40, 2000, 200, 900), at, field, margin)).toEqual({
      x: 0,
      y: margin - 2000,
      zoom: 1,
    })
  })

  it('leaves a target longer than the field while its start stands in the field’s first half, at any margin', () => {
    const wide = box(1000, 900, 640, 80)
    const stood = revealView(wide, at, field, margin)
    expect(stood).not.toBeNull()
    // The same target revealed again with no margin, as a focus does after a press, stays.
    expect(stood && revealView(wide, stood, field, 0)).toBeNull()
    const inHalf = { x: 150 - 1000, y: 600 / 2 - 940, zoom: 1 }
    expect(revealView(wide, inHalf, field, margin)).toBeNull()
  })

  it('leaves a target that fits only without the margin where a reveal with the margin stood it', () => {
    // 380 of 390: past the room 16 clear of each edge keeps, within the field itself.
    const near = box(1000, 900, 380, 80)
    const stood = revealView(near, at, field, margin)
    expect(stood).toEqual({ x: margin - 1000, y: 600 / 2 - 940, zoom: 1 })
    expect(stood && revealView(near, stood, field, 0)).toBeNull()
  })

  it('brings a target longer than the field to its start once that start leaves the first half', () => {
    const wide = box(1000, 900, 640, 80)
    const y = 600 / 2 - 940
    for (const start of [250, 4]) {
      expect(revealView(wide, { x: start - 1000, y, zoom: 1 }, field, margin)).toEqual({
        x: margin - 1000,
        y,
        zoom: 1,
      })
    }
  })
})
