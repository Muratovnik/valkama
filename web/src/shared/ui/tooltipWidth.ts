/**
 * How wide the window's one hint (`TooltipHost`) is drawn, worked out before it is: the host
 * decides from it whether the hint fits on the side its element asks for. Each estimate reads
 * the same tokens the hint is laid out by, so a change of a token moves both.
 */
import { drawnWidth } from '@/shared/lib/textWidth.ts'
import type { Figures } from '@/shared/lib/textWidth.ts'
import type { TooltipBody } from '@/shared/ui/tooltipAnchors.ts'

/** The root's tokens, as the hint is drawn by them: a length in px, and a font. */
function tokens() {
  const root = getComputedStyle(document.documentElement)
  return {
    px: (name: string) => Number.parseFloat(root.getPropertyValue(name)) || 0,
    font: (name: string) => root.getPropertyValue(name).trim(),
  }
}

/**
 * How wide the hint's lines are drawn, its padding and its border (`.tooltip-hint`) included:
 * its element's own words first while they are cut, its text, its note.
 */
export function hintWidth(lines: readonly string[]): number {
  const { px, font } = tokens()
  const note = font('--font-note')
  return Math.max(0, ...lines.map((line) => drawnWidth(line, note))) + 2 * (px('--space-2') + 1)
}

/**
 * How wide a hint drawn as a grid is (`TooltipBody.vue`), its padding and border included: its
 * widest name, figure and share with the room between its columns and a swatch where a row or
 * its head has one, or its widest note, each inside a row's inset. A name a row can mark is measured semibold,
 * as the grid holds its width.
 */
export function bodyWidth(body: TooltipBody): number {
  const { px, font } = tokens()
  const [note, label] = [font('--font-note'), font('--font-label')]
  const widest = (texts: readonly (string | undefined)[], drawn = note, figures?: Figures) =>
    Math.max(0, ...texts.map((text = '') => drawnWidth(text, drawn, figures)))
  // `.tooltip-body`: the room between columns, and the swatch's size.
  const gap = px('--space-2')
  const series = body.head.slot !== undefined
  const swatched = series || body.rows.some((row) => row.slot !== undefined)
  const swatch = swatched ? px('--space-2') + gap : 0
  const quiet = body.quiet ?? []
  // A quiet name starts where the swatch does, and so does a head's that is no series; a row's
  // name, and a series head's, after it.
  const name = Math.max(
    widest([body.head.name], label) - (series ? 0 : swatch),
    widest(quiet.map((line) => line.name)) - swatch,
    ...body.rows.map((row) => drawnWidth(row.name, row.key ? label : note)),
  )
  // Figures and shares are drawn in figures of one width (`.tooltip-body-figure`).
  const figures = widest(
    [body.head.figure, ...quiet.map((line) => line.figure), ...body.rows.map((row) => row.figure)],
    note,
    'tabular',
  )
  const shares = body.rows.some((row) => row.share)
    ? gap +
      widest(
        body.rows.map((row) => row.share),
        note,
        'tabular',
      )
    : 0
  const rows = swatch + Math.max(0, name) + gap + figures + shares
  // A row's inset, then the hint's own padding and border (`.tooltip-hint-body`).
  const inset = 2 * px('--space-1') + 2 * (px('--space-1') + 1)
  return Math.max(rows, widest(body.notes ?? [])) + inset
}
