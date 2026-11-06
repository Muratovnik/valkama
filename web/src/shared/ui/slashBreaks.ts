/**
 * Text that may also break after each `/`, which a browser does not offer on its own.
 *
 * A run of words joined by slashes, a path or `loading/empty/error/unavailable` in a
 * title, is one word to a browser. Wider than its line it either pushed past the edge
 * or, under `overflow-wrap: anywhere`, broke wherever the line ran out: «un» on one line
 * and «available» on the next. A word breaks inside now only when that one word is wider
 * than its line.
 *
 * Each piece that ends in a `/` is a span whose `::after` draws a zero-width space with
 * empty alternative text (`.slash-break` in `base.css`). The space is a place to break and
 * is not text: the text node, a selection's copy and the accessible name are the title as
 * written, character for character. A `<wbr>` was the place to break before, and Chromium
 * names an element with a space at each one («loading/ empty/ error»), so a screen reader
 * read a title that was never written; a zero-width space without the empty alternative is
 * read into the name as itself.
 *
 * A directive rather than a component: a title stands in every tile and every row of a
 * list, where a component instance each is a cost the board's budget refuses. The element
 * it sits on holds the text and nothing else.
 */
import type { Directive } from 'vue'

/** The class of a piece that may break after its `/` (`base.css`). */
export const SLASH_BREAK = 'slash-break'

/** The text cut after each `/`: every piece but the last ends in one. */
export const slashPieces = (text: string) => text.split(/(?<=\/)/u)

function piece(text: string) {
  const span = document.createElement('span')
  span.className = SLASH_BREAK
  span.textContent = text
  return span
}

function draw(element: HTMLElement, text: string) {
  const pieces = slashPieces(text)
  element.replaceChildren(
    ...pieces.map((part, index) => (index < pieces.length - 1 ? piece(part) : part)),
  )
}

export const vSlashBreaks: Directive<HTMLElement, string> = {
  beforeMount: (element, { value }) => draw(element, value),
  updated: (element, { value, oldValue }) => {
    if (value !== oldValue) draw(element, value)
  },
}
