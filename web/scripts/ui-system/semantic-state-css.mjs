import { posix } from 'node:path'

import {
  isTokenFunction,
  isTokenIdent,
  isTokenWhiteSpaceOrComment,
  tokenize,
  TokenType,
} from '@csstools/css-tokenizer'
import { parse as parseCss } from 'postcss'
import selectorParser from 'postcss-selector-parser'

export const SEMANTIC_MARK_PROPERTY =
  /^(?:accent-color|background(?:-color|-image)?|border(?:(?:-(?:block|inline)(?:-(?:start|end))?|-(?:top|right|bottom|left))(?:-color)?|-color)?|box-shadow|caret-color|color|column-rule(?:-color)?|fill|filter|flood-color|lighting-color|outline(?:-color)?|stop-color|stroke|text-decoration-color|text-emphasis-color|text-shadow|-webkit-text-fill-color|-webkit-text-stroke(?:-color)?)$/u

function decodeCssIdentifier(identifier) {
  let parseError = null
  const tokens = tokenize({ css: identifier }, { onParseError: (error) => (parseError ??= error) })
  if (
    parseError ||
    tokens.length !== 2 ||
    !isTokenIdent(tokens[0]) ||
    tokens[1][0] !== TokenType.EOF
  )
    throw new Error(`Expected one CSS identifier, received ${JSON.stringify(identifier)}`)
  return tokens[0][4].value
}

export function normalizeStyleProperty(property) {
  const decoded = decodeCssIdentifier(property)
  if (decoded.startsWith('--')) return decoded
  const hyphenated = decoded
    .replaceAll(/([a-z\d])([A-Z])/g, '$1-$2')
    .replace(/^ms-/u, '-ms-')
    .toLowerCase()
  return /^(?:moz|webkit)-/u.test(hyphenated) ? `-${hyphenated}` : hyphenated
}

function styleSourcePath(componentFile, reference) {
  const clean = reference.replaceAll('\\', '/').split(/[?#]/u, 1)[0]
  if (clean.startsWith('@/')) return clean.slice(2)
  if (!clean.startsWith('.')) return null
  return posix.normalize(posix.join(posix.dirname(componentFile), clean))
}

/** Inline and external styles authored by one component. */
export function localStyles(file, source, sourceByFile) {
  const styles = []
  for (const match of source.matchAll(/<style\b([^>]*)>([\s\S]*?)<\/style>/giu)) {
    styles.push(match[2])
    const reference = /\bsrc\s*=\s*(['"])(.*?)\1/iu.exec(match[1])?.[2]
    if (!reference) continue
    const target = styleSourcePath(file, reference)
    const external = target && sourceByFile.get(target)
    if (external !== undefined) styles.push(external)
  }
  return styles.join('\n')
}

function ruleSelector(rule) {
  const selectors = []
  for (let current = rule; current; current = current.parent)
    if (current.type === 'rule') selectors.unshift(current.selector)
  return selectors.join(' ')
}

function cssRules(css) {
  const rules = []
  parseCss(css).walkRules((rule) => {
    const declarations = rule.nodes
      .filter((node) => node.type === 'decl')
      .map((node) => ({ property: decodeCssIdentifier(node.prop), value: node.value }))
    if (declarations.length > 0) rules.push({ declarations, selector: ruleSelector(rule) })
  })
  return rules
}

export function cssDeclarations(source) {
  const declarations = []
  parseCss(source).walkDecls((declaration) => {
    declarations.push({
      property: decodeCssIdentifier(declaration.prop),
      value: declaration.value,
    })
  })
  return declarations
}

function insideNegativeSelector(node) {
  for (let current = node.parent; current; current = current.parent)
    if (current.type === 'pseudo' && current.value.toLowerCase() === ':not') return true
  return false
}

function selectorFacts(selector) {
  const attributes = new Map()
  const classes = new Set()
  const root = selectorParser().astSync(selector)
  root.walkClasses((node) => {
    if (!insideNegativeSelector(node)) classes.add(node.value)
  })
  root.walkIds((node) => {
    if (insideNegativeSelector(node)) return
    const values = attributes.get('id') ?? new Set()
    values.add(node.value)
    attributes.set('id', values)
  })
  root.walkAttributes((node) => {
    if (insideNegativeSelector(node)) return
    const attribute = node.attribute.toLowerCase()
    if (attribute === 'class') {
      const exactToken =
        typeof node.value === 'string' &&
        !node.insensitive &&
        (node.operator === '~=' || (node.operator === '=' && !/\s/u.test(node.value)))
      classes.add(exactToken ? node.value : null)
      return
    }
    const values = attributes.get(attribute) ?? new Set()
    values.add(
      node.operator === '=' && typeof node.value === 'string' && !node.insensitive
        ? node.value
        : null,
    )
    attributes.set(attribute, values)
  })
  return { attributes, classes }
}

function cssValueTokens(value) {
  let parseError = null
  const tokens = tokenize({ css: value }, { onParseError: (error) => (parseError ??= error) })
  if (parseError) throw parseError
  return tokens
}

function valueContainsFunction(value, name) {
  return cssValueTokens(value).some(
    (token) => isTokenFunction(token) && token[4].value.toLowerCase() === name,
  )
}

function customPropertyReferences(value) {
  const properties = []
  const tokens = cssValueTokens(value)
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (!isTokenFunction(token) || token[4].value.toLowerCase() !== 'var') continue
    let argument = tokens[index + 1]
    while (isTokenWhiteSpaceOrComment(argument)) {
      index += 1
      argument = tokens[index + 1]
    }
    if (isTokenIdent(argument) && argument[4].value.startsWith('--'))
      properties.push(argument[4].value)
  }
  return properties
}

function directStatusTones(value) {
  return customPropertyReferences(value)
    .map((property) => /^--color-(danger|info|success|warning)$/u.exec(property)?.[1])
    .filter(Boolean)
}

function customPropertyDefinitions(rules) {
  const definitions = new Map()
  for (const rule of rules)
    for (const declaration of rule.declarations) {
      if (!declaration.property.startsWith('--')) continue
      const entries = definitions.get(declaration.property) ?? []
      entries.push({ selector: rule.selector, value: declaration.value })
      definitions.set(declaration.property, entries)
    }
  return definitions
}

function valueToneSources(value, definitions, resolving = new Set()) {
  const sources = directStatusTones(value).map((tone) => ({ selectors: [], tone }))
  for (const property of customPropertyReferences(value)) {
    if (/^--color-(?:danger|info|success|warning)$/u.test(property) || resolving.has(property))
      continue
    for (const definition of definitions.get(property) ?? [])
      for (const source of valueToneSources(
        definition.value,
        definitions,
        new Set(resolving).add(property),
      ))
        sources.push({ selectors: [definition.selector, ...source.selectors], tone: source.tone })
  }
  return sources
}

function statusMark(selector, tone) {
  return { ...selectorFacts(selector), tone }
}

export function semanticStatusMarks(css) {
  const rules = cssRules(css)
  const definitions = customPropertyDefinitions(rules)
  const marks = []
  for (const rule of rules)
    for (const declaration of rule.declarations) {
      if (!SEMANTIC_MARK_PROPERTY.test(normalizeStyleProperty(declaration.property))) continue
      for (const source of valueToneSources(declaration.value, definitions))
        marks.push(statusMark([...source.selectors, rule.selector].join(' '), source.tone))
    }
  return marks
}

function paintCustomPropertiesFromRules(rules) {
  const definitions = customPropertyDefinitions(rules)
  const paint = new Set()
  const trace = (property) => {
    if (paint.has(property)) return
    paint.add(property)
    for (const definition of definitions.get(property) ?? [])
      for (const reference of customPropertyReferences(definition.value)) trace(reference)
  }
  for (const rule of rules)
    for (const declaration of rule.declarations)
      if (SEMANTIC_MARK_PROPERTY.test(normalizeStyleProperty(declaration.property)))
        for (const property of customPropertyReferences(declaration.value)) trace(property)
  return paint
}

export function paintCustomProperties(css) {
  return paintCustomPropertiesFromRules(cssRules(css))
}

/** Vue CSS bindings may express layout, but never a component-local paint channel. */
export function cssDynamicPaintViolates(css) {
  const rules = cssRules(css)
  const paintProperties = paintCustomPropertiesFromRules(rules)
  return rules.some((rule) =>
    rule.declarations.some((declaration) => {
      if (!valueContainsFunction(declaration.value, 'v-bind')) return false
      const property = normalizeStyleProperty(declaration.property)
      return SEMANTIC_MARK_PROPERTY.test(property) || paintProperties.has(property)
    }),
  )
}
