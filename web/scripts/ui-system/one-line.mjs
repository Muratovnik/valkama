/**
 * A label that keeps to one line ends in an ellipsis through one rule, `.one-line` in
 * `shell.css`, and offers its whole words through a `clipped` hint while they are cut.
 *
 * Twenty-nine rules wrote the three lines each before the class existed, and nine more were
 * left after it: each kept its ellipsis, and none carried the hint, so a cut filter, a cut
 * finder detail or a cut holder could not be read whole. A browser walk that found labels by the
 * class passed every one of them, because a copy does not carry the class.
 *
 * So no other rule may end text in an ellipsis (`text-overflow` other than `clip`), and none may
 * hold text to one line and clip it there (`white-space: nowrap` beside an `overflow` that clips
 * across), which is the same rule with its ellipsis forgotten. A rule that hides its element
 * whole and leaves it to assistive technology (`clip-path: inset(50%)`) cuts no words a reader
 * sees. A comment may name the properties: only a declaration counts.
 *
 * A real exception is registered below by file and selector, with its reason; a registered one
 * that is gone is refused too, so the register says what the tree holds.
 */
import { rulesOf, stylesOf } from './css-rules.mjs'

export const ONE_LINE_OWNER = 'app/styles/shell.css'

/** The owner's own rules: the one-line label, and the trimmed word that is cut sideways only. */
const OWN_RULES = new Set(['.one-line', '.trimmed-word'])

/** `file selector` → why that place cannot be a one-line label of the shared rule. */
export const ONE_LINE_COPIES = new Map()

/** An ellipsis, or any other mark that stands for cut text; `clip` is the initial value. */
const ELLIPSIS = /(?:^|[;{\s])text-overflow\s*:\s*(?!clip\s*(?:!important\s*)?(?:;|$))[^;\s]/im
/** Text held to one line. */
const NO_WRAP =
  /(?:^|[;{\s])(?:white-space\s*:\s*(?:nowrap|pre)\b|text-wrap(?:-mode)?\s*:\s*nowrap\b)/im
/** An overflow that clips across: the shorthand's first value, or the inline axis's own. */
const CLIPS_ACROSS = /(?:^|[;{\s])overflow(?:-x|-inline)?\s*:\s*(?:hidden|clip)\b/im
/** The element is hidden whole, kept for assistive technology alone. */
const HIDDEN_WHOLE = /(?:^|[;{\s])(?:clip-path\s*:\s*inset\(\s*50%\s*\)|clip\s*:\s*rect\()/im

/** How a rule is named in a finding and in the register: its file and its selectors, outermost first. */
const placeOf = (file, chain) => `${file} ${chain.join(' ').replaceAll(/\s+/g, ' ')}`

/** What is wrong with one rule, if it copies the one-line rule. */
function copyOf(own) {
  if (ELLIPSIS.test(own)) return 'ends text in an ellipsis of its own'
  if (NO_WRAP.test(own) && CLIPS_ACROSS.test(own) && !HIDDEN_WHOLE.test(own))
    return 'holds text to one line and clips it with no ellipsis'
  return null
}

/** Every copy in one source, each with its place. */
function* copiesIn({ file, source }) {
  const css = stylesOf(file, source)
  if (!css) return
  for (const { chain, own } of rulesOf(css)) {
    if (file === ONE_LINE_OWNER && chain.length === 1 && OWN_RULES.has(chain[0])) continue
    const fault = copyOf(own)
    if (fault) yield { fault, place: placeOf(file, chain) }
  }
}

export function scanOneLineCopies(sources, register = ONE_LINE_COPIES) {
  const violations = []
  const seen = new Set()
  for (const entry of sources)
    for (const { fault, place } of copiesIn(entry)) {
      if (register.has(place)) seen.add(place)
      else
        violations.push(
          `${place}: ${fault}; write the shared one-line class (${ONE_LINE_OWNER}) on the element, or trimmed-word one-line on a trimmed word, with a clipped hint of its whole words, or register why it cannot`,
        )
    }
  for (const place of register.keys())
    if (!seen.has(place)) violations.push(`${place}: registered as a one-line exception, and gone`)
  return violations
}
