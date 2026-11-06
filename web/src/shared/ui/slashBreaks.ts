/**
 * Text that may also break after each `/`, which a browser does not offer on its own.
 *
 * A run of words joined by slashes, a path or `loading/empty/error/unavailable` in a
 * title, is one word to a browser. Wider than its line it either pushed past the edge
 * or, under `overflow-wrap: anywhere`, broke wherever the line ran out: «un» on one line
 * and «available» on the next. A `<wbr>` after each `/` is a place to break that adds no
 * character, so the text reads, copies and is named as it was written, and a word breaks
 * inside only when that one word is wider than its line.
 *
 * A directive rather than a component: a title stands in every tile and every row of a
 * list, where a component instance each is a cost the board's budget refuses. The element
 * it sits on holds the text and nothing else.
 */
import type { Directive } from 'vue'

/** The text cut after each `/`, the pieces a `<wbr>` goes between. */
export const slashPieces = (text: string) => text.split(/(?<=\/)/u)

function draw(element: HTMLElement, text: string) {
  element.replaceChildren(
    ...slashPieces(text).flatMap((piece, index) =>
      index ? [document.createElement('wbr'), piece] : [piece],
    ),
  )
}

export const vSlashBreaks: Directive<HTMLElement, string> = {
  beforeMount: (element, { value }) => draw(element, value),
  updated: (element, { value, oldValue }) => {
    if (value !== oldValue) draw(element, value)
  },
}
