/**
 * Text that may also break after each `/`, which a browser does not offer on its own.
 *
 * A run of words joined by slashes, a path or `loading/empty/error/unavailable` in a
 * title, is one word to a browser. Wider than its line it either pushed past the edge
 * or, under `overflow-wrap: anywhere`, broke wherever the line ran out: «un» on one line
 * and «available» on the next. Each `/` here is followed by a `<wbr>`, a place to break
 * that adds no character, so the text reads, copies and is named as it was written, and a
 * word breaks inside only when that one word is wider than its line.
 */
import { Fragment, h } from 'vue'
import type { FunctionalComponent } from 'vue'

export const SlashBreaks: FunctionalComponent<{ text: string }> = ({ text }) =>
  h(
    Fragment,
    text.split(/(?<=\/)/u).flatMap((piece, index) => (index ? [h('wbr'), piece] : [piece])),
  )
