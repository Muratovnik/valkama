import { posix } from 'node:path'

import { parse as parseCss } from 'postcss'
import selectorParser from 'postcss-selector-parser'
import { parse } from 'vue/compiler-sfc'

import { styleBlocks } from './sfc.mjs'

/**
 * A scoped rule never reaches the class written on a floating Reka part.
 *
 * Reka draws the floating content its `*Portal` parts place — a menu, a hover card, a select's
 * list — inside a positioning wrapper of its own (`data-reka-popper-content-wrapper`), and hands
 * the attributes written on the part's tag to the element inside that wrapper. Vue gives this
 * component's scope attribute to the root of the part, which is the wrapper. So in
 * `<DropdownMenuContent class="menu-popup">` the element with `menu-popup` never carries the
 * attribute, and a scoped `.menu-popup` matches nothing: the menu was drawn with no fill, no edge
 * and no shadow, and no check said so.
 *
 * What a portal moves is not what loses the scope. A `<Teleport>` keeps it — an element is stamped
 * by the template that writes it, wherever it is mounted — and so does everything this template
 * writes inside a floating part, an item part included: their scoped rules land, and this rule
 * leaves them alone. The parts it reads are the ones whose tag class is known to land past the
 * wrapper. `tests/components/floatingPartScope.spec.ts` renders the menu, hover card, popover,
 * tooltip, select and combobox parts and fails when Reka changes where the class lands; the
 * context-menu, menubar and sub-menu parts reach the same wrapper through the menu's own content.
 *
 * A surface rule for such a class goes in an unscoped block of its own, as `VMenu`'s does, or on
 * an element this template writes inside the part, as `SearchCombobox`'s `.combo-popup` does.
 */

/**
 * The Reka parts that place their tag's class inside a wrapper. `ComboboxContent` only does so
 * with `position="popper"`; inline, it draws its own element and keeps the scope.
 */
export const FLOATING_PARTS = new Map([
  ['ComboboxContent', { position: 'popper' }],
  ['ContextMenuContent', {}],
  ['ContextMenuSubContent', {}],
  ['DropdownMenuContent', {}],
  ['DropdownMenuSubContent', {}],
  ['HoverCardContent', {}],
  ['MenubarContent', {}],
  ['MenubarSubContent', {}],
  ['PopoverContent', {}],
  ['SelectContent', {}],
  ['TooltipContent', {}],
])

const NODE_ELEMENT = 1
const NODE_ATTRIBUTE = 6
const REKA_IMPORT = /\bimport\s*\{([^}]*)\}\s*from\s*['"]reka-ui['"]/gu

const kebab = (name) => name.replaceAll(/(?<=[a-z\d])([A-Z])/gu, '-$1').toLowerCase()

/** The floating parts a script imports, by every tag a template may write for each. */
function importedParts(descriptor) {
  const parts = new Map()
  for (const script of [descriptor.script, descriptor.scriptSetup]) {
    if (!script) continue
    for (const [, names] of script.content.matchAll(REKA_IMPORT)) {
      for (const entry of names.split(',')) {
        const [imported, local = imported] = entry
          .trim()
          .replace(/^type\s+/u, '')
          .split(/\s+as\s+/u)
        if (!FLOATING_PARTS.has(imported)) continue
        parts.set(local, imported)
        parts.set(kebab(local), imported)
      }
    }
  }
  return parts
}

const staticAttribute = (node, name) =>
  node.props.find((prop) => prop.type === NODE_ATTRIBUTE && prop.name === name)

/** Every class written as text on a floating part's tag, with the part and the line of the tag. */
function floatingClasses(descriptor) {
  const parts = importedParts(descriptor)
  const found = new Map()
  const visit = (node) => {
    if (node.type === NODE_ELEMENT) {
      const part = parts.get(node.tag)
      const needs = part && FLOATING_PARTS.get(part)
      const fits =
        needs &&
        (!needs.position || staticAttribute(node, 'position')?.value?.content === needs.position)
      const written = fits && staticAttribute(node, 'class')?.value?.content
      for (const name of written ? written.split(/\s+/u).filter(Boolean) : [])
        if (!found.has(name)) found.set(name, { line: node.loc.start.line, part })
    }
    for (const child of node.children ?? []) visit(child)
  }
  if (descriptor.template?.ast) visit(descriptor.template.ast)
  return found
}

/** The selectors a rule matches with, its nesting resolved: `&` is its parent, else a descendant. */
function resolvedSelectors(rule) {
  const own = branches(rule.selector)
  let parent = rule.parent
  while (parent && parent.type !== 'rule' && parent.type !== 'root') parent = parent.parent
  return parent && parent.type === 'rule'
    ? resolvedSelectors(parent).flatMap((outer) =>
        own.map((inner) =>
          inner.includes('&') ? inner.replaceAll('&', outer) : `${outer} ${inner}`,
        ),
      )
    : own
}

const branches = (selector) =>
  selectorParser()
    .astSync(selector)
    .nodes.map((branch) => String(branch).trim())

/**
 * The classes of the compound Vue stamps with the scope attribute: the last one, after the last
 * combinator, outside any pseudo-class's parentheses, so a class inside `:is()` or `:where()` is
 * not read. A selector that leaves its scope (`:deep()`, `:global()`, `:slotted()`) is not read
 * either: `scanScopeEscapes` holds those.
 */
function stampedClasses(selector) {
  const classes = []
  selectorParser((root) => {
    for (const branch of root.nodes) {
      const escapes = branch.nodes.some(
        (node) =>
          node.type === 'pseudo' &&
          /^(?::deep|::v-deep|:global|::v-global|:slotted|::v-slotted)$/u.test(node.value),
      )
      if (escapes) continue
      const last = branch.nodes.findLastIndex((node) => node.type === 'combinator')
      for (const node of branch.nodes.slice(last + 1))
        if (node.type === 'class') classes.push(node.value)
    }
  }).processSync(selector)
  return classes
}

/** The scoped stylesheets of a component: its inline blocks, and a sheet it scopes with `src`. */
function scopedSheets(file, source, sourceByFile) {
  const sheets = []
  for (const block of styleBlocks(source)) {
    if (!block.attrs.scoped) continue
    if (typeof block.attrs.src !== 'string') {
      sheets.push({ css: block.content, file, firstLine: block.line })
      continue
    }
    const target = posix.join(posix.dirname(file), block.attrs.src)
    const css = sourceByFile.get(target)
    if (css !== undefined) sheets.push({ css, file: target, firstLine: 1 })
  }
  return sheets
}

const insideKeyframes = (rule) => {
  for (let node = rule.parent; node; node = node.parent)
    if (node.type === 'atrule' && /keyframes$/iu.test(node.name)) return true
  return false
}

export function scanFloatingPartScopes(sources) {
  const violations = []
  const sourceByFile = new Map(sources.map(({ file, source }) => [file, source]))
  for (const { file, source } of sources) {
    if (!file.endsWith('.vue')) continue
    const { descriptor } = parse(source, { filename: file, sourceMap: false })
    const classes = floatingClasses(descriptor)
    if (classes.size === 0) continue
    for (const sheet of scopedSheets(file, source, sourceByFile)) {
      parseCss(sheet.css).walkRules((rule) => {
        if (insideKeyframes(rule) || !rule.nodes.some((node) => node.type === 'decl')) return
        const named = new Set(
          resolvedSelectors(rule).flatMap((selector) => stampedClasses(selector)),
        )
        for (const name of named) {
          const written = classes.get(name)
          if (!written) continue
          const line = sheet.firstLine + rule.source.start.line - 1
          violations.push(
            `${sheet.file}:${line}: the scoped rule \`${rule.selector}\` styles .${name}, which ${file}:${written.line} writes on <${written.part}>; Reka puts that class inside its own wrapper, without this component's scope, so the rule never matches — style the class in an unscoped <style> block, or an element this template writes inside the part`,
          )
        }
      })
    }
  }
  return violations
}
