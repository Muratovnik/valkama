/**
 * Text whose lines break only between its words, never inside one.
 *
 * A browser also breaks after a hyphen, so a session's start, `5d1e0c2a-9f3b`, a project's key
 * or any name joined by hyphens could end one line at its hyphen and go on at the start of the
 * next, where it no longer reads as one name. Each word here is a box of its own
 * (`.whole-word` in `base.css`), which goes to the next line whole; only a word wider than a
 * whole line breaks inside, where it has to.
 *
 * The spaces stay text between the boxes, so the element's text, a selection's copy and the
 * accessible name are the text as written.
 *
 * A directive, as `vSlashBreaks` is, for text a render function draws in a run of marks as
 * well as for a template. The element it sits on holds the text and nothing else.
 */
import type { Directive } from 'vue'

/** The class of a word no line breaks inside (`base.css`). */
const WHOLE_WORD = 'whole-word'

/** The text cut into its words and the runs of space between them, in order. */
const wordPieces = (text: string) => text.split(/(\s+)/u).filter((piece) => piece !== '')

function word(text: string) {
  const span = document.createElement('span')
  span.className = WHOLE_WORD
  span.textContent = text
  return span
}

function draw(element: HTMLElement, text: string) {
  element.replaceChildren(
    ...wordPieces(text).map((piece) => (/^\s+$/u.test(piece) ? piece : word(piece))),
  )
}

export const vWholeWords: Directive<HTMLElement, string> = {
  beforeMount: (element, { value }) => draw(element, value),
  updated: (element, { value, oldValue }) => {
    if (value !== oldValue) draw(element, value)
  },
}
