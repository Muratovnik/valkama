/**
 * Where the camera goes to bring the target the keyboard reached into sight, at the
 * zoom the operator chose. A target already in view, `margin` clear of the field's
 * edges, leaves the camera where it is; any other is centred. Along an axis the target
 * is longer than the field — a root's header on a phone, a tall frame — centring would
 * cut both its ends, so there its start stands at the margin, as it is read, and it
 * counts as in view once it stands there.
 */

import type { ViewportTransform } from '@vue-flow/core'

import type { Box } from '@/widgets/work-item-graph/utils/graphWalk.ts'

interface Axis {
  /** The target's length along it, in the field's own units. */
  length: number
  /** Where the camera stands along it. */
  offset: number
  /** The field's length along it. */
  span: number
  /** The target's start along it, in the field's own units. */
  start: number
}

/** The camera's offset along one axis, and whether it moved. */
function revealAxis(axis: Axis, zoom: number, margin: number): { moved: boolean; offset: number } {
  const shown = axis.start * zoom + axis.offset
  const length = axis.length * zoom
  if (length > axis.span - 2 * margin) {
    const offset = margin - axis.start * zoom
    return { moved: Math.abs(shown - margin) >= 0.5, offset }
  }
  const inView = shown >= margin && shown + length <= axis.span - margin
  const centred = axis.span / 2 - (axis.start + axis.length / 2) * zoom
  return { moved: !inView, offset: centred }
}

/** The camera that brings `target` into sight, or null when it is already there. */
export function revealView(
  target: Box,
  camera: ViewportTransform,
  field: { height: number; width: number },
  margin: number,
): ViewportTransform | null {
  const { zoom } = camera
  const x = revealAxis(
    { offset: camera.x, span: field.width, start: target.x, length: target.width },
    zoom,
    margin,
  )
  const y = revealAxis(
    { offset: camera.y, span: field.height, start: target.y, length: target.height },
    zoom,
    margin,
  )
  return x.moved || y.moved ? { x: x.offset, y: y.offset, zoom } : null
}
