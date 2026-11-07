/**
 * A focus ring is as wide as the one the keyboard's ring in `base.css` draws: `--size-focus-ring`,
 * which what a ring stands round keeps room for. Thirty rings wrote that width as `2px`, so the
 * token named a width they would not have followed.
 *
 * A focus ring is an outline a rule draws for a focus state: `:focus`, `:focus-visible` or
 * `:focus-within` in its selector or in one it is nested in, and not only inside `:not()`. Such an
 * outline may not write its width itself, in px, rem or a keyword, directly, in a fallback, or
 * through a custom property the same file sets to one. Any other outline keeps its own width: a
 * forced palette's 1px frame, a dashed drop target, a highlighted option's mark. No rule here
 * draws a focus ring for anything but a focus state; one that comes to is named beside them.
 */
import { parse as parseCss } from 'postcss'
import selectorParser from 'postcss-selector-parser'

import { uncommented } from './comments.mjs'

const FOCUS_STATES = new Set([':focus', ':focus-visible', ':focus-within'])

/** A width written out: a length in px or rem, or one of the keyword widths. */
const LITERAL_WIDTH =
  /(?<![\w.-])(?:(?:\d+\.?\d*|\.\d+)(?:px|rem)\b|(?:thin|medium|thick)(?![\w-]))/i

/** The custom properties a value reads, fallbacks included. */
const readProperties = (value) => [...value.matchAll(/var\(\s*(--[\w-]+)/g)].map(([, name]) => name)

function insideNot(node) {
  for (let current = node.parent; current; current = current.parent)
    if (current.type === 'pseudo' && current.value.toLowerCase() === ':not') return true
  return false
}

/** Whether a selector names a focus state other than as what an element is not. */
function namesFocus(selector) {
  let found = false
  try {
    selectorParser((root) => {
      root.walkPseudos((pseudo) => {
        if (FOCUS_STATES.has(pseudo.value.toLowerCase()) && !insideNot(pseudo)) found = true
      })
    }).processSync(selector)
  } catch {
    // A selector the parser cannot read is taken at its word: a focus state named anywhere.
    return /:focus(?:-visible|-within)?(?![\w-])/i.test(selector)
  }
  return found
}

/** Whether a declaration stands in a rule, or under one, that draws a focus state. */
function forFocus(declaration) {
  for (let rule = declaration.parent; rule; rule = rule.parent)
    if (rule.type === 'rule' && namesFocus(rule.selector)) return true
  return false
}

/** The style a file authors: a stylesheet whole, a component's `<style>` blocks. */
function stylesOf(file, source) {
  const code = uncommented(file, source)
  return file.endsWith('.css')
    ? code
    : [...code.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map(([, css]) => css).join('\n')
}

export function scanFocusRingWidths(sources) {
  const violations = []
  for (const { file, source } of sources) {
    if (!/\.(?:vue|css)$/.test(file)) continue
    let tree
    try {
      tree = parseCss(stylesOf(file, source))
    } catch {
      // A sheet that is no stylesheet draws no ring, and the style linter refuses it.
      continue
    }
    const literal = new Set()
    tree.walkDecls(/^--/, (declaration) => {
      if (LITERAL_WIDTH.test(declaration.value)) literal.add(declaration.prop)
    })
    let rings = 0
    tree.walkDecls(/^outline(?:-width)?$/i, (declaration) => {
      if (!forFocus(declaration)) return
      const { value } = declaration
      if (LITERAL_WIDTH.test(value) || readProperties(value).some((name) => literal.has(name)))
        rings += 1
    })
    if (rings)
      violations.push(
        `${file}: writes the width of ${rings} focus ring(s) itself; a focus ring's width is var(--size-focus-ring)`,
      )
  }
  return violations
}
