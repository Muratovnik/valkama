/**
 * `text-box` has one home.
 *
 * Trimming a box to its letters leaves it one x-height tall, with capitals and descenders
 * standing outside it, so it is safe only beside an overflow that does not clip at it. Written
 * twice, the pair is a line to remember: the third use trimmed a word that had inherited
 * `overflow: hidden`, and every card cut the tops of its letters. So `.trimmed-word` says both
 * and no other rule may say the first. A comment may name the property: only a declaration fails.
 */

import { styleBlocks } from './sfc.mjs'

const OWNER = 'app/styles/shell.css'
const COMMENT = /\/\*[\s\S]*?\*\//g
const TRIM = /(?:^|[{;\s])text-box(?:-trim|-edge)?\s*:/g
/** The class's own rule, cut out of its owner so that what is left is held like any other file. */
const OWN_RULE = /\.trimmed-word\s*\{[^}]*\}/

function stylesOf({ file, source }) {
  if (file.endsWith('.css')) return source
  if (!file.endsWith('.vue')) return ''
  return styleBlocks(source)
    .map((block) => block.content)
    .join('\n')
}

export function scanTrimmedWords(sources) {
  const violations = []
  for (const entry of sources) {
    const css = stylesOf(entry).replaceAll(COMMENT, '')
    const held = entry.file === OWNER ? css.replace(OWN_RULE, '') : css
    if ([...held.matchAll(TRIM)].length > 0) {
      violations.push(
        `${entry.file}: declares text-box outside .trimmed-word; a trimmed box is one x-height tall and whatever clips at it cuts the letters, so write that class on the element, which says the trim and the overflow it needs together`,
      )
    }
  }
  return violations
}
