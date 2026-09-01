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
 */
export function compactCss(source: string): string {
  return flattenNesting(source).replaceAll(/\s+/g, '').replaceAll(';}', '}')
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
 */
function flattenNesting(source: string): string {
  const flatten = (css: string, parents: string[]): string => {
    const { declarations, rules } = parseBlock(css)
    let out = ''
    if (declarations.length && parents.some(Boolean)) {
      out += `${parents.join(',')}{${declarations.join(';')}}`
    }
    for (const rule of rules) {
      if (rule.selector.startsWith('@')) {
        out += `${rule.selector}{${flatten(rule.body, parents)}}`
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

  // A `.css` file is CSS throughout; inside an SFC only the style block is, and
  // the rest of the file has braces of its own.
  if (!/<style[^>]*>/.test(source)) return flatten(withoutComments(source), [''])
  return source.replaceAll(/(<style[^>]*>)([\s\S]*?)(<\/style>)/g, (_, open, css, close) => {
    return `${open}${flatten(withoutComments(css as string), [''])}${close}`
  })
}
