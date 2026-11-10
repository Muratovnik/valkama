/** The stylesheet of a source and its rules, for the guards that read declarations rule by rule. */

import { uncommented } from './comments.mjs'
import { styleBlocks } from './sfc.mjs'

/** The stylesheet text of a source, comments out: a CSS file whole, a component's style blocks. */
export function stylesOf(file, source) {
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
export function* rulesOf(css) {
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
