/**
 * An action a row keeps out of sight until the pointer or the keyboard is on it: whether a
 * pointer can hover is asked once, in `reveal.css`, and every such action takes its sight from
 * there. Four buttons did it in three ways before. The rail's pin hid itself, so Tab passed it by
 * on the way back; a lane heading's card and chain faded and asked the keyboard's focus alone; and
 * a checklist step's discussion asked nothing and stood on every step. Each copy that asked about
 * hover asked it in its own words.
 *
 * Two questions find a copy. A query about hover outside the owner is one: an action kept out of
 * sight has to stand where nothing can hover, so a copy asks it. A rule that brings something into
 * sight under the pointer is the other, since it means something stood out of sight until the
 * pointer came; that catches the copy that never asked about hover at all. Focus alone is not
 * asked: a drawer's bar keeps a part the keyboard holds in sight while its scroll fades it.
 *
 * The owner hides an action only where a pointer can hover: hidden anywhere else, it could never
 * be brought up on a screen nothing hovers.
 */

import { uncommented } from './comments.mjs'
import { conditionsOf } from './finger.mjs'
import { styleBlocks } from './sfc.mjs'

export const REVEAL_OWNER = 'shared/ui/reveal.css'

/** The one query the owner asks, spaces and case aside. */
const CAN_HOVER = '(hover:hover)'

/**
 * What is not an action kept out of sight, each with why.
 *
 * The rail's lead has room for one glyph: an epic at work shows its sign there at rest, and the
 * fold's arrow takes the sign's place under the pointer and focus. The fold is in sight at rest
 * as the sign, and pressed there it folds; the two glyphs trade one cell. Only the rule for those
 * two glyphs is let through, not the file: the pin's own copy stood in the same file.
 */
const SWAPS = new Map([
  ['widgets/app-nav/components/NavWorkRow.vue', /^\.nav-row-(?:chevron|sign)$/],
])

/** A condition that asks whether a pointer can hover, any pointer's included. */
const HOVER_FEATURE = /(?<![\w-])(?:any-)?hover\s*[:)]/i

/** A selector that holds for the pointer on it. */
const HOVERED = /:hover(?![\w-])/i

/** A declaration that brings something into sight: full opacity, visible, a sight token set so. */
const INTO_SIGHT =
  /(?:^|[;{])\s*(?:opacity\s*:\s*(?:1|1\.0*|100%)\s*(?:;|$)|visibility\s*:\s*visible|--[\w-]+\s*:\s*visible\b)/im

/** A declaration that takes something out of sight. */
const OUT_OF_SIGHT = /(?:^|[;{])\s*(?:opacity\s*:\s*0(?:\.0*)?\s*(?:;|$)|visibility\s*:\s*hidden)/im

/** The stylesheet text of a source: a CSS file whole, a component's style blocks. */
function stylesOf(file, source) {
  if (file.endsWith('.css')) return uncommented(file, source)
  if (!file.endsWith('.vue')) return ''
  return styleBlocks(source)
    .map((block) => uncommented('style.css', block.content))
    .join('\n')
}

/**
 * Every rule at any depth, with the selectors that enclose it and the declarations it makes
 * itself. Nested rules are taken out of a rule's own text, so a parent is not credited with what
 * its child declares.
 */
function* rulesOf(css) {
  const open = []
  let mark = 0
  for (let index = 0; index < css.length; index += 1) {
    const character = css[index]
    if (character === '{') {
      const selector = css.slice(mark, index).split(/[;}]/).pop().trim()
      open.push({ selector, own: '' })
      mark = index + 1
    } else if (character === '}') {
      const rule = open.pop()
      if (!rule) continue
      rule.own += css.slice(mark, index)
      yield { chain: [...open.map((each) => each.selector), rule.selector], own: rule.own }
      mark = index + 1
    } else if (character === ';' && open.length) {
      open.at(-1).own += css.slice(mark, index + 1)
      mark = index + 1
    }
  }
}

/** The query lists of every `@media` rule in a stylesheet. */
const mediaLists = (css) => [...css.matchAll(/@media\b([^{;]*)\{/gi)].map(([, list]) => list)

/** A query list as one spelling, condition by condition, spaces and case aside. */
const spelled = (list) => conditionsOf(list).join(',').replaceAll(/\s+/g, '').toLowerCase()

/** What the owner hides outside its one query: an action no screen without hover can bring up. */
function ownerFindings(css) {
  const findings = []
  const asked = mediaLists(css).map((list) => spelled(list))
  if (asked.length !== 1 || asked[0] !== CAN_HOVER)
    findings.push(`${REVEAL_OWNER}: asks only ${CAN_HOVER.replace(':', ': ')}, once`)
  for (const { chain, own } of rulesOf(css)) {
    if (!OUT_OF_SIGHT.test(own)) continue
    const inside = chain.some(
      (selector) => /^@media\b/i.test(selector) && spelled(selector.slice(6)) === CAN_HOVER,
    )
    if (!inside)
      findings.push(
        `${REVEAL_OWNER}: hides an action where nothing can hover; hide it only under (hover: hover)`,
      )
  }
  return findings
}

/** A copy of the rule in any other file: a question about hover, or sight the pointer brings. */
function copyFindings(file, css) {
  const findings = []
  for (const list of mediaLists(css)) {
    if (!conditionsOf(list).some((condition) => HOVER_FEATURE.test(condition))) continue
    findings.push(
      `${file}: whether a pointer can hover is asked once, in reveal.css; reveal an action with its classes`,
    )
  }
  const swap = SWAPS.get(file)
  for (const { chain, own } of rulesOf(css)) {
    if (!INTO_SIGHT.test(own) || swap?.test(chain.at(-1))) continue
    if (!chain.some((selector) => HOVERED.test(selector))) continue
    findings.push(
      `${file}: brings something into sight under the pointer; an action kept out of sight until then takes reveal-row and reveal from reveal.css`,
    )
  }
  return findings
}

export function scanRevealCopies(sources) {
  return sources.flatMap(({ file, source }) => {
    const css = stylesOf(file, source)
    if (!css) return []
    return file === REVEAL_OWNER ? ownerFindings(css) : copyFindings(file, css)
  })
}
