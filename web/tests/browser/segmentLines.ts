/**
 * The lines of a row of segments that may wrap (`SegmentedControl`'s `wrap`), and every way they
 * break the rule DESIGN.md sets for it (Segmented choice): wrapped, the row stands in columns of
 * one width, every line but the last full from the track's start to its end, the last short only
 * where no number of columns divides the segments, each segment under the one at its place on the
 * first line, and in the fewest columns that keep to that many lines — four two over two, never
 * three over one.
 */
import type { Page } from '@playwright/test'

/** A row as it stands: the room its track gives, and each line's segment edges. */
export interface SegmentLines {
  end: number
  lines: [number, number][][]
  start: number
}

/**
 * The rows the selectors name, each a radio group or a tab list, its segments its radios or its
 * tabs; a row not drawn has no lines.
 */
export function segmentLines(page: Page, tracks: readonly string[]): Promise<SegmentLines[]> {
  return page.evaluate(
    (selectors) =>
      selectors.map((selector) => {
        const track = document.querySelector(selector)
        if (!track) return { end: 0, lines: [], start: 0 }
        const style = getComputedStyle(track)
        const box = track.getBoundingClientRect()
        const lines = new Map<number, [number, number][]>()
        for (const segment of track.querySelectorAll('[role="radio"], [role="tab"]')) {
          const { left, right, top } = segment.getBoundingClientRect()
          lines.set(Math.round(top), [...(lines.get(Math.round(top)) ?? []), [left, right]])
        }
        return {
          end: box.right - Number.parseFloat(style.paddingRight),
          lines: [...lines.values()],
          start: box.left + Number.parseFloat(style.paddingLeft),
        }
      }),
    tracks,
  )
}

/** Within half a pixel: an edge laid out on the same track lands on the same pixel. */
const near = (one: number | undefined, other: number | undefined) =>
  one !== undefined && other !== undefined && Math.abs(one - other) <= 0.5

/** Every way a wrapped row's lines break the rule; a row on one line breaks nothing. */
export function missesOf({ end, lines, start }: SegmentLines): string[] {
  const [first = []] = lines
  if (lines.length < 2) return []
  const columns = first.length
  const count = lines.flat().length
  const shape = lines.map((line) => line.length).join('+')
  return [
    ...(Math.ceil(count / lines.length) === columns
      ? []
      : [`${count} segments stand ${shape}, not in the fewest columns for ${lines.length} lines`]),
    ...lines.flatMap((line, at) => {
      const last = at === lines.length - 1
      return [
        ...(near(line[0]?.[0], start) ? [] : [`line ${at} starts at ${line[0]?.[0]} of ${start}`]),
        ...(last || near(line.at(-1)?.[1], end)
          ? []
          : [`line ${at} ends at ${line.at(-1)?.[1]} of ${end}`]),
        ...(line.length === columns || (last && line.length < columns)
          ? []
          : [`line ${at} holds ${line.length} of ${columns}`]),
        ...line
          .filter(
            ([left, right], index) =>
              !(near(left, first[index]?.[0]) && near(right, first[index]?.[1])),
          )
          .map((edges) => `line ${at} segment at ${edges.join('..')} misses the first line`),
      ]
    }),
  ]
}
