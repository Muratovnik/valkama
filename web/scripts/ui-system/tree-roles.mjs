/**
 * A tree's role and the attributes that place its rows come from one file,
 * `shared/lib/treeRows.ts`, and every table that is a tree takes them from there
 * through `v-bind`: `treeGridAttrs` for the table, `treeRowAttrs` for a row.
 *
 * A tree written by hand in a second place says something else to a reader
 * sooner or later: a level counted from 0 rather than 1, a place among siblings
 * the browser cannot count once only a window of the rows is drawn, a row that
 * says it is open with nothing under it. So the role `treegrid` and the
 * attributes `aria-level`, `aria-setsize` and `aria-posinset`, or the DOM's
 * properties for them, appear in no other script or template. A comment may
 * name them. `aria-expanded` and `aria-rowindex` are not held here: a
 * disclosure and a flat list write them as well.
 */

import { uncommented } from './comments.mjs'

export const TREE_ROLES_OWNER = 'shared/lib/treeRows.ts'

const TREE_WORDS =
  /(?<![\w-])(?:treegrid|aria-(?:level|setsize|posinset))(?![\w-])|\baria(?:Level|SetSize|PosInSet)\b/gi

const lineOf = (source, index) => source.slice(0, index).split('\n').length

export function scanTreeRoles(sources) {
  const violations = []
  for (const { file, source } of sources) {
    if (!/\.(?:ts|vue)$/.test(file) || file === TREE_ROLES_OWNER) continue
    const code = uncommented(file, source)
    for (const match of code.matchAll(TREE_WORDS))
      violations.push(
        `${file}:${lineOf(code, match.index)}: ${match[0]} is a tree's role or a tree row's place; take them from ${TREE_ROLES_OWNER} with v-bind="treeGridAttrs(…)" or v-bind="treeRowAttrs(row)"`,
      )
  }
  return violations
}
