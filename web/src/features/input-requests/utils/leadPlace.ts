/**
 * Whether the comment's press on a question stands on the line of what comes before the two
 * answers, on a row as narrow as a phone's, worked out from widths alone.
 *
 * It does only where it and everything offered there fit one line together: the way to the task
 * and the read of its status, or the room the asking keeps, whichever is wider. Where they do not,
 * the place has its line alone and the press stays on the buttons' line, as it always did; let in
 * anyway, the place broke from the press and left it a line alone, a line more than without it.
 * Where nothing is offered there the press stays on the buttons' line too, since a line that only
 * keeps the asking's room has nothing to lead.
 *
 * The widths come in the 64ths of a pixel layout works in, so the sum is the sum flex makes, and a
 * line filled exactly holds.
 */

/** The widths the place is read from, none of which the place itself changes. */
export interface LeadRow {
  /** Between the row's members, and between the controls in the place. */
  controlGap: number
  controls: number[]
  gap: number
  /** The row's width. */
  line: number
  /** What the host put first; zero where it put nothing. */
  press: number
  /** What the place keeps for the asking where it can be asked, or zero. */
  room: number
}

export function pressLeads(row: LeadRow): boolean {
  if (row.controls.length === 0 || row.press === 0) return false
  const controls =
    row.controls.reduce((sum, width) => sum + width, 0) + row.controlGap * (row.controls.length - 1)
  return row.press + row.gap + Math.max(controls, row.room) <= row.line
}
