import { readFileSync } from 'node:fs'

import { uncommented } from '../../scripts/ui-system/comments.mjs'
import { styleBlocks } from '../../scripts/ui-system/sfc.mjs'

/**
 * A file under `src/` as code, every comment taken out as its language writes one.
 *
 * A source-text check that reads the raw file is satisfied by the text in a comment
 * after the code it was about is gone, and a negative one fails on a comment that
 * names what it forbids.
 */
export function sourceCode(path: string): string {
  return uncommented(path, readFileSync(new URL(`../../src/${path}`, import.meta.url), 'utf8'))
}

/**
 * Every declaration the stylesheet gives `selector` itself, as `compactCss` writes them.
 *
 * The selector is matched whole, so `.segmented` is not found in `.x.segmented` or
 * `.segmented-option`, and the declarations are a set, so their order is not a rule.
 */
export function declarationsOf(css: string, selector: string): string[] {
  const compact = compactCss(css)
  // In a component only its style blocks are CSS.
  const sheets = compact.includes('<style')
    ? [...compact.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(([, sheet]) => sheet)
    : [compact]
  const wanted = compactSelector(selector)
  const found: string[] = []
  for (const sheet of sheets)
    for (const [, selectors, body] of sheet.matchAll(/(?<=^|[{};])([^{};]+)\{([^{}]*)\}/g))
      if (selectors.split(',').includes(wanted)) found.push(...body.split(';').filter(Boolean))
  return found
}

/**
 * Source-text assertions describe intent, not formatting. Compacting the style
 * block keeps them true whether the file is minified or laid out by Prettier —
 * and, since these stylesheets nest, whether a relationship is written as a
 * descendant selector or as a nested rule.
 *
 * Flattening first is what makes that last part true. A test that asserts a
 * control's height is asserting what a browser computes, and a browser sees
 * `.segmented .segmented-option`; whether the author wrote one selector or two
 * nested rules is a way of writing, and a test coupled to it fails on a refactor
 * that changed nothing it was measuring. Four did.
 *
 * Whitespace goes everywhere but in one place: between two parts of a selector it
 * is the descendant combinator, so it stays as one space. `.a .b` is a `.b` inside
 * an `.a` and `.a.b` is one element with both classes; read as the same text, a
 * check of a selector's declarations accepts a rule moved to another element.
 */
export function compactCss(source: string): string {
  // A `.css` file is CSS throughout; inside an SFC only the style blocks are, and
  // the rest of the file has braces of its own.
  const blocks = styleBlocks(source)
  if (blocks.length === 0) return flattenNesting(source)
  let out = ''
  let cursor = 0
  for (const block of blocks) {
    out += squeeze(source.slice(cursor, block.start)) + flattenNesting(block.content)
    cursor = block.end
  }
  return out + squeeze(source.slice(cursor))
}

/** Text with no whitespace at all, and no `;` before a closing brace. */
const squeeze = (text: string) => text.replaceAll(/\s+/g, '').replaceAll(';}', '}')

/**
 * A selector list laid out one way: a descendant is one space, and nothing else
 * keeps any — not a list's commas, another combinator or a bracket's edges.
 */
function compactSelector(selector: string): string {
  return selector
    .trim()
    .replaceAll(/\s+/g, ' ')
    .replaceAll(/ ?([>+~,=]) ?/g, '$1')
    .replaceAll(/([([]) /g, '$1')
    .replaceAll(/ ([)\]])/g, '$1')
}

/** A comment can hold a brace, so it goes before any of this is parsed. */
const withoutComments = (css: string) => css.replaceAll(/\/\*[\s\S]*?\*\//g, '')

type Rule = { body: string; end: number; selector: string; start: number }
type Block = { declarations: string[]; rules: Rule[] }

/**
 * The rules directly inside a block, with the span each one occupies.
 *
 * Spans rather than text, because the declarations the block owns are then the
 * complement: everything the rules do not cover. One loop over the braces answers
 * both questions, and neither needs to know how deep the nesting goes.
 */
function topLevelRules(css: string): Rule[] {
  const rules: Rule[] = []
  let depth = 0
  let start = 0
  let open = 0
  for (let index = 0; index < css.length; index += 1) {
    if (css[index] === '{') {
      depth += 1
      if (depth === 1) open = index
    } else if (css[index] === '}') {
      depth -= 1
      if (depth === 0) {
        // The selector is what follows the last declaration, not everything
        // since the previous rule: `display: flex; .cell {` has both in it.
        const head = css.slice(start, open)
        const cut = head.lastIndexOf(';') + 1
        rules.push({
          body: css.slice(open + 1, index),
          end: index + 1,
          selector: head.slice(cut).trim(),
          start: start + cut,
        })
        start = index + 1
      }
    }
  }
  return rules
}

/** One block, split into the declarations it owns and the rules inside it. */
function parseBlock(css: string): Block {
  const rules = topLevelRules(css)
  let leftover = ''
  let cursor = 0
  for (const rule of rules) {
    leftover += css.slice(cursor, rule.start)
    cursor = rule.end
  }
  leftover += css.slice(cursor)
  return {
    declarations: leftover
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean),
    rules,
  }
}

/**
 * Desugar native nesting into the descendant selectors it stands for.
 *
 * `&` takes the parent selector's place; a nested rule that starts with a
 * combinator or a bare compound gets the parent and a descendant space, which is
 * what the CSS Nesting spec prepends for it. An at-rule keeps its own block and
 * its contents flatten inside it, so a `@container` around a nested rule still
 * reads as the query it is.
 *
 * The result is already compact: a selector as `compactSelector` lays it out, and
 * a declaration or an at-rule's prelude with no whitespace at all.
 */
function flattenNesting(sheet: string): string {
  const flatten = (css: string, parents: string[]): string => {
    const { declarations, rules } = parseBlock(css)
    let out = ''
    if (declarations.length && parents.some(Boolean)) {
      const body = declarations.map((each) => each.replaceAll(/\s+/g, '')).join(';')
      out += `${compactSelector(parents.join(','))}{${body}}`
    }
    for (const rule of rules) {
      if (rule.selector.startsWith('@')) {
        out += `${rule.selector.replaceAll(/\s+/g, '')}{${flatten(rule.body, parents)}}`
        continue
      }
      const selectors = parents.flatMap((parent) =>
        rule.selector.split(',').map((part) => {
          const one = part.trim()
          if (!parent) return one
          return one.startsWith('&') ? one.replace(/^&/, parent) : `${parent} ${one}`
        }),
      )
      out += flatten(rule.body, selectors)
    }
    return out
  }
  return flatten(withoutComments(sheet), [''])
}
