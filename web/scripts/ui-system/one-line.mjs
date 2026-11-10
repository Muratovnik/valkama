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
 * The parts of one copy need not stand in one rule. Rules a file writes for the same selector are
 * read as one. And `.trimmed-word` ends its word in an ellipsis of its own, for a word cut
 * sideways only: on an element that a rule of the same component holds to one line, itself or
 * through what holds it, that is a one-line label drawn without the class or its hint, as the
 * state's word stood before it took them. A template's static class is what is read.
 *
 * A real exception is registered below by file and selector, with its reason; a registered one
 * that is gone is refused too, so the register says what the tree holds.
 */
import { parse } from 'vue/compiler-sfc'

import { rulesOf, stylesOf } from './css-rules.mjs'

export const ONE_LINE_OWNER = 'app/styles/shell.css'

/** The owner's own rules: the one-line label, and the trimmed word that is cut sideways only. */
const OWN_RULES = new Set(['.one-line', '.trimmed-word'])

/**
 * `file selector`, or `file <tag> class="…"` for a trimmed word, → why that place cannot be a
 * one-line label of the shared rule.
 */
export const ONE_LINE_COPIES = new Map([
  [
    'widgets/app-nav/components/NavWorkLink.vue <span> class="trimmed-word"',
    'the row’s count of agents beside its icon: the meta box never shrinks (flex: none), so its word is never cut and has nothing to say whole',
  ],
  [
    'widgets/work-item-inspector/components/InspectorIdentity.vue <span> class="identity-fact identity-updated trimmed-word"',
    'the card’s date in its bar of facts, where nothing shortens (flex: none) and what does not fit steps aside whole: the date is never cut',
  ],
])

const ELEMENT = 1
const ATTRIBUTE = 6
const IF = 9

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

/** A file's rules by selector, the declarations of every rule for the same one read together. */
function rulesBySelector(css) {
  const rules = new Map()
  for (const { chain, own } of rulesOf(css)) {
    const key = chain.join(' ').replaceAll(/\s+/g, ' ')
    const rule = rules.get(key)
    if (rule) rule.own += `;${own}`
    else rules.set(key, { chain, own })
  }
  return [...rules.values()]
}

/** The classes of the element a selector list styles: each selector's last compound. */
function subjectClasses(chain) {
  const classes = new Set()
  for (const selector of chain.at(-1).split(',')) {
    const subject =
      selector
        .trim()
        .split(/[\s>+~]+/u)
        .at(-1) ?? ''
    for (const [, name] of subject.matchAll(/\.([\w-]+)/gu)) classes.add(name)
  }
  return classes
}

/** The static classes of a template element. */
const classesOf = (node) =>
  (
    node.props.find((prop) => prop.type === ATTRIBUTE && prop.name === 'class')?.value?.content ??
    ''
  )
    .split(/\s+/u)
    .filter(Boolean)

/** The elements of a template, each with the static classes of those that hold it. */
function* elementsOf(node, held = []) {
  let inside = held
  if (node.type === ELEMENT) {
    const classes = classesOf(node)
    yield { classes, held, node }
    inside = [...held, ...classes]
  }
  for (const child of node.children ?? []) yield* elementsOf(child, inside)
  for (const branch of node.type === IF ? node.branches : []) yield* elementsOf(branch, inside)
}

/** The trimmed words of a component that a rule of its own holds to one line. */
function* trimmedWordsIn(file, source, rules) {
  const oneLine = new Set()
  for (const { chain, own } of rules)
    if (NO_WRAP.test(own) && !HIDDEN_WHOLE.test(own))
      for (const name of subjectClasses(chain)) oneLine.add(name)
  const template = oneLine.size ? parse(source).descriptor.template : null
  if (!template) return
  for (const { classes, held, node } of elementsOf(template.ast)) {
    if (!classes.includes('trimmed-word') || classes.includes('one-line')) continue
    const holder = [...classes, ...held].find((name) => oneLine.has(name))
    if (holder)
      yield {
        fault: `is a trimmed word, which ends in an ellipsis, held to one line by .${holder}`,
        place: `${file} <${node.tag}> class="${classes.join(' ')}"`,
      }
  }
}

/** Every copy in one source, each with its place. */
function* copiesIn({ file, source }) {
  const css = stylesOf(file, source)
  if (!css) return
  const rules = rulesBySelector(css)
  for (const { chain, own } of rules) {
    if (file === ONE_LINE_OWNER && chain.length === 1 && OWN_RULES.has(chain[0])) continue
    const fault = copyOf(own)
    if (fault) yield { fault, place: placeOf(file, chain) }
  }
  if (file.endsWith('.vue')) yield* trimmedWordsIn(file, source, rules)
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
