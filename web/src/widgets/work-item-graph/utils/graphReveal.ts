/**
 * Where the camera goes to bring the target the keyboard reached into sight, at the
 * zoom the operator chose. Each axis is its own: along one where the target is in view,
 * `margin` clear of the field's edges, the camera stays; along any other the target is
 * centred. Along an axis the target is longer than the field — a root's header on a
 * phone — centring would cut both its ends, so there it is in view while its start
 * stands in the field's first half, and is otherwise brought there, its start at the
 * margin, as it is read.
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

/** The camera's offset along one axis: where it stands, when the target is in view along it. */
function revealAxis(axis: Axis, zoom: number, margin: number): number {
  const shown = axis.start * zoom + axis.offset
  const length = axis.length * zoom
  if (length > axis.span - 2 * margin)
    return shown >= margin && shown <= axis.span / 2 ? axis.offset : margin - axis.start * zoom
  const inView = shown >= margin && shown + length <= axis.span - margin
  return inView ? axis.offset : axis.span / 2 - (axis.start + axis.length / 2) * zoom
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
  return x === camera.x && y === camera.y ? null : { x, y, zoom }
}
