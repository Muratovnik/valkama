/**
 * A selector list must not repeat a compound across all of its members.
 *
 *     .tone-info .state-dot,
 *     .tone-success .state-dot,
 *     .tone-warning .state-dot,
 *     .tone-danger .state-dot { background: currentcolor }
 *
 * says `.state-dot` four times to make one statement about it, and the reader has
 * to compare four lines to find the one word that differs. `:is(.tone-info,
 * .tone-success, .tone-warning, .tone-danger) .state-dot` says it once, and so
 * does the same list nested under a shared parent.
 *
 * Nothing published answers this. `csstools/use-nesting` asks whether two *rules*
 * can become one nested rule and never looks inside a list;
 * `stylelint-no-restricted-syntax` queries the PostCSS AST by attribute
 * (`rule[selector='a']`), which cannot compare one comma member with another; and
 * stylelint ships no core rule about the shape of a list. So it is here, beside
 * `stylelint-order-preset.js`, which is the other selector-shape decision this
 * repository states for itself.
 *
 * Two conditions keep a report from being advice the reader has to refuse.
 *
 * The members must have equal specificity. `:is()` takes the MAXIMUM of its
 * arguments and CSS nesting desugars a parent list to `:is()` as well, so folding
 * `.a > header button, .b button` would lift the second member from (0,1,1) to
 * (0,1,2) and quietly reorder the cascade.
 *
 * And the shared compound must be reached the same way in every member.
 * `.recovery > button, .choices button` both end in `button`, but folding them
 * would give the second member's descendant reach to the first. Lists like those
 * repeat a fragment because they are two ideas that ought to share a class, which
 * is a design decision rather than a mechanical one.
 *
 * Which fix applies is decided by where Vue puts the scope attribute, probed
 * rather than assumed: `:is()` in the tail leaves it alone, `:is()` in the head
 * moves it onto the parent — `.d > :is(section, footer)` stamps `.d`, which would
 * let a child component's `<section>` match — and `:deep(a, b)` silently drops
 * everything after its first argument, so a list of those becomes
 * `:deep(:is(a, b))`.
 */

import parser from 'postcss-selector-parser'
import stylelint from 'stylelint'

const ruleName = 'valkama/selector-list-no-repeated-compound'

const messages = stylelint.utils.ruleMessages(ruleName, {
  repeated: (compound, where) =>
    `Every member of this list ${where} \`${compound}\`. Say it once — wrap the parts that ` +
    `differ in \`:is()\`, nest them under it, or drop the \`&\` if that is all it is.`,
})

/** Pseudo-classes whose specificity is the largest of their arguments. */
const WIDEST_ARGUMENT = new Set([':is', ':not', ':has', ':matches'])

/**
 * Vue's own pseudo-classes, erased before a browser reads the file.
 *
 * `:deep()` becomes a combinator and `:slotted()` an attribute, so neither
 * contributes anything of its own; what is inside them still does.
 */
const ERASED = new Set([':deep', '::v-deep', ':slotted', '::v-slotted'])

/** Contributes nothing, arguments included. */
const WEIGHTLESS = new Set([':where', ':global', '::v-global'])

/**
 * One member split into its compounds, with the combinator that reaches each.
 *
 * The first compound is reached by nothing and carries an empty combinator, which
 * is what makes two members' heads comparable at all.
 */
function steps(member) {
  const found = []
  let combinator = ''
  let compound = ''
  for (const node of member.nodes) {
    if (node.type === 'combinator') {
      if (compound.trim()) found.push({ combinator, compound: compound.trim() })
      combinator = String(node).trim() || ' '
      compound = ''
      continue
    }
    // `String(node)` keeps the raw text, and the first node of every member after
    // the first carries whatever followed the comma. Left in, the leading newline
    // of a list written across two lines made one compound look like two, and the
    // rule then reported nothing at all.
    compound += String(node)
  }
  if (compound.trim()) found.push({ combinator, compound: compound.trim() })
  return found
}

/** Whether two steps name the same compound reached the same way. */
const sameStep = (left, right) =>
  left.compound === right.compound && left.combinator === right.combinator

/** The larger of two specificities, compared the way the cascade compares them. */
function larger(left, right) {
  for (const index of [0, 1, 2]) {
    if (left[index] !== right[index]) return left[index] > right[index] ? left : right
  }
  return left
}

/**
 * Specificity as `[id, class, type]`.
 *
 * Enough of it to answer one question: are these members equal? A `&` stands for
 * a parent this rule cannot see, but it stands for the same parent in every member
 * of one list, so counting it as nothing keeps the comparison honest.
 *
 * The walk is written out rather than delegated to `container.walk`, whose
 * callback returning `false` interrupts the whole traversal instead of skipping
 * one subtree — which silently stopped the count at the first pseudo-class.
 */
function specificity(node) {
  const total = [0, 0, 0]
  const add = (other) => {
    for (const index of [0, 1, 2]) total[index] += other[index]
  }

  for (const child of node.nodes ?? []) {
    switch (child.type) {
      case 'id': {
        add([1, 0, 0])
        break
      }
      case 'class':
      case 'attribute': {
        add([0, 1, 0])
        break
      }
      case 'tag': {
        add([0, 0, 1])
        break
      }
      case 'pseudo': {
        const name = child.value.toLowerCase()
        if (WEIGHTLESS.has(name)) break
        if (WIDEST_ARGUMENT.has(name) || ERASED.has(name)) add(widest(child.nodes ?? []))
        else if (name.startsWith('::')) add([0, 0, 1])
        else add([0, 1, 0])
        break
      }
      default: {
        // A combinator, a `&`, a comment or the universal selector: no weight.
        break
      }
    }
  }
  return total
}

/** The largest specificity among a pseudo-class's arguments. */
function widest(nodes) {
  let best = [0, 0, 0]
  for (const one of nodes) best = larger(best, specificity(one))
  return best
}

const equal = (left, right) => left.every((value, index) => value === right[index])

const plugin = stylelint.createPlugin(ruleName, (primary, secondary) => {
  if (!primary) return () => {}
  const ignore = new Set(secondary?.ignore ?? [])
  return (root, result) => {
    root.walkRules((rule) => {
      if (!rule.selector.includes(',')) return
      let members
      try {
        members = parser().astSync(rule.selector).nodes
      } catch {
        // An unparseable selector belongs to `no-parsing-error`, not to this rule;
        // staying quiet keeps one defect to one message.
        return
      }
      if (members.length < 2) return

      const chains = members.map((member) => steps(member))
      // A member of one compound has nothing to share with the others.
      if (chains.some((one) => one.length < 2)) return

      const [reference] = chains
      const sharedTail = chains.every((one) => sameStep(one.at(-1), reference.at(-1)))
      const sharedHead = chains.every((one) => sameStep(one[0], reference[0]))
      if (!sharedTail && !sharedHead) return

      const shared = sharedTail ? reference.at(-1).compound : reference[0].compound
      if (ignore.has(shared)) return

      const [first] = members.map((member) => specificity(member))
      if (!members.every((member) => equal(specificity(member), first))) return

      stylelint.utils.report({
        message: messages.repeated(shared, sharedTail ? 'ends with' : 'begins with'),
        node: rule,
        result,
        ruleName,
        word: shared,
      })
    })
  }
})

plugin.ruleName = ruleName
plugin.messages = messages

export default plugin
