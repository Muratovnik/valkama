/**
 * The rows a list draws in its first frame, and the rest right after it.
 *
 * Opening a list of a thousand rows drew, styled and laid out all of them before
 * anything showed, and most are below the fold. So the first frame holds what
 * fills the list's height, and the next task draws every other row; none is ever
 * taken out of the DOM again, so a sort, a filter, the keyboard and the browser's
 * find work on all of them from then on.
 *
 * A table works out its column widths from every cell it holds, so the rest
 * arriving would move the columns. The first frame therefore also holds the row
 * with the widest value of each column, collapsed: a collapsed row gives its
 * widths and takes no height. A scroll cannot outrun the rows, because the table
 * ends where the drawn rows end until the rest are there.
 *
 * Only the first drawing is staged. Where nothing lays the page out, or the rows
 * change meanwhile, every row is drawn at once.
 */
import { computed, onScopeDispose, shallowRef, watch } from 'vue'

/** A row's height is never less than this, so this many fill any height. */
const SHORTEST_ROW = 36
/** Rows beyond the fold, so a first scroll does not reach the table's end. */
const BEYOND_THE_FOLD = 12

const nothing = () => {}

/** The widest of some words in one font; of equal length the canvas decides. */
function widestWord(
  words: readonly (readonly [string, number])[],
  canvas: CanvasRenderingContext2D,
  font: string,
) {
  let longest = 0
  for (const [word] of words) longest = Math.max(longest, word.length)
  canvas.font = font
  let widest = -1
  let at = -1
  const measured = new Map<string, number>()
  for (const [word, index] of words) {
    if (word.length < longest - 1) continue
    const width = measured.get(word) ?? canvas.measureText(word).width
    measured.set(word, width)
    if (width > widest) {
      widest = width
      at = index
    }
  }
  return at
}

/** One column: what a row prints in it, and the token of the font it prints in. */
interface StagedColumn<Row> {
  font: string
  word: (row: Row) => string
}

interface StagedRows<Row> {
  columns: readonly StagedColumn<Row>[]
  /** The element that scrolls the rows; its height says how many fill it. */
  root: () => HTMLElement | null
  rows: () => readonly Row[]
}

export function useStagedRows<Row>({ columns, root, rows }: StagedRows<Row>) {
  /** The rows of the first frame, for as long as there is one. */
  const staged = shallowRef<{ all: readonly Row[]; first: readonly Row[]; held: Set<Row> } | null>(
    null,
  )
  let cancel = nothing

  function settle() {
    cancel()
    cancel = nothing
    staged.value = null
  }

  function heldRows(all: readonly Row[], shown: number) {
    const canvas = document.createElement('canvas').getContext('2d')
    if (!canvas) return null
    const style = getComputedStyle(document.documentElement)
    const held = new Set<Row>()
    for (const { font, word } of columns) {
      const at = widestWord(
        all.map((row, index) => [word(row), index] as const),
        canvas,
        style.getPropertyValue(font),
      )
      if (at >= shown) held.add(all[at] as Row)
    }
    return held
  }

  /** Draw the first frame, and the rest once it has been painted. */
  function stage() {
    const all = rows()
    const height = root()?.clientHeight ?? 0
    const shown = Math.ceil(height / SHORTEST_ROW) + BEYOND_THE_FOLD
    const held = height > 0 && all.length > shown ? heldRows(all, shown) : null
    if (!held) return
    staged.value = { all, first: all.slice(0, shown), held }
    let done = false
    const finish = () => {
      if (!done) settle()
      done = true
    }
    const frame = requestAnimationFrame(() => setTimeout(finish))
    // A window out of sight has no frames, and its rows are drawn all the same.
    const late = setTimeout(finish, 250)
    cancel = () => {
      done = true
      cancelAnimationFrame(frame)
      clearTimeout(late)
    }
  }

  // The rows changed before the rest were drawn: they are all drawn now.
  watch(rows, (all) => {
    if (staged.value && all !== staged.value.all) settle()
  })
  onScopeDispose(() => cancel())

  return {
    /** A row in the first frame only for its widths. */
    held: (row: Row) => staged.value?.held.has(row) ?? false,
    rows: computed(() => {
      const now = staged.value
      return now ? [...now.first, ...now.held] : rows()
    }),
    stage,
  }
}
