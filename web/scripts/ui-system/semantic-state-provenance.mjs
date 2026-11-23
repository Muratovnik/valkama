/**
 * Where a value in a component comes from, as far as the semantic-state rules
 * need it: a presentation from the canonical uiSystem helpers and its `tone`,
 * a fixed string, a `computed` or a `ref`. Names resolve through
 * `semantic-state-bindings.mjs`, so a value written in a composable or a helper
 * module the component imports is read where it is written.
 */

import { bindingIndex, unwrapExpression } from './semantic-state-bindings.mjs'

const UI_SYSTEM_SOURCE = '@/shared/lib/uiSystem.ts'
const PRESENTATION_HELPERS = new Set(['semanticStatePresentation', 'statePresentation'])

/** The imports read as what they are rather than followed into their module. */
function canonicalCall(source, imported) {
  if (source === 'vue' && (imported === 'computed' || imported === 'ref')) return imported
  if (source === UI_SYSTEM_SOURCE && PRESENTATION_HELPERS.has(imported)) return 'presentation'
  return null
}

function namedProperty(node) {
  if (!node) return null
  if (!node.computed && node.property?.type === 'Identifier') return node.property.name
  if (node.computed && node.property?.type === 'Literal') return node.property.value
  return null
}

function returnedExpression(callback) {
  const body = unwrapExpression(callback)?.body
  return body?.type === 'BlockStatement' ? null : body
}

const UNKNOWN_STRINGS = { unknown: true, values: new Set() }

/**
 * The provenance of every file of the tree. `provenanceOf(file)` answers for
 * one component or module; each answer may lead into another file's.
 */
export function presentationIndex(sourceByFile) {
  const bindings = bindingIndex(
    sourceByFile,
    (source, imported) => canonicalCall(source, imported) !== null,
  )
  const byOwner = new Map()

  function provenanceFor(owner) {
    if (byOwner.has(owner)) return byOwner.get(owner)
    const provenance = ownerProvenance(owner)
    byOwner.set(owner, provenance)
    return provenance
  }

  /** What a callee is read as: `computed`, `ref`, a presentation helper, or null. */
  function callKind(owner, callee, scope) {
    const binding = bindings.bindingOf(owner, unwrapExpression(callee), scope)
    return binding?.kind === 'import' ? canonicalCall(binding.source, binding.imported) : null
  }

  /** A `const`'s initializer with its file, or null for any other binding. */
  function constant(owner, identifier, scope) {
    const binding = bindings.bindingOf(owner, identifier, scope)
    return binding?.kind === 'const' ? binding : null
  }

  function callProvenance(owner, expression, resolving, scope) {
    const kind = callKind(owner, expression.callee, scope)
    if (kind === 'presentation') return 'presentation'
    return kind === 'computed'
      ? provenanceKind(owner, returnedExpression(expression.arguments[0]), resolving, scope)
      : null
  }

  function provenanceKind(owner, node, resolving = new Set(), scope = null) {
    const expression = unwrapExpression(node)
    if (!expression) return null
    if (expression.type === 'CallExpression')
      return callProvenance(owner, expression, resolving, scope)
    if (expression.type === 'Identifier') {
      const binding = constant(owner, expression, scope)
      return !binding || resolving.has(binding.variable)
        ? null
        : provenanceKind(binding.owner, binding.init, new Set(resolving).add(binding.variable))
    }
    if (expression.type === 'MemberExpression') {
      const kind = provenanceKind(owner, expression.object, resolving, scope)
      return namedProperty(expression) === 'tone' && kind === 'presentation' ? 'tone' : null
    }
    return null
  }

  function interpolationParts(owner, node, scope) {
    const expression = unwrapExpression(node)
    if (!expression) return { hasTone: false, safe: false }
    if (provenanceKind(owner, expression, new Set(), scope) === 'tone')
      return { hasTone: true, safe: true }
    if (expression.type === 'Literal' && typeof expression.value === 'string')
      return { hasTone: false, safe: true }
    let nodes = null
    if (expression.type === 'TemplateLiteral') nodes = expression.expressions
    else if (expression.type === 'BinaryExpression' && expression.operator === '+')
      nodes = [expression.left, expression.right]
    if (!nodes) return { hasTone: false, safe: false }
    const parts = nodes.map((entry) => interpolationParts(owner, entry, scope))
    return {
      hasTone: parts.some((part) => part.hasTone),
      safe: parts.every((part) => part.safe),
    }
  }

  function staticStringOptions(owner, node, resolving = new Set(), scope = null) {
    const expression = unwrapExpression(node)
    if (!expression) return UNKNOWN_STRINGS
    if (expression.type === 'Literal' && typeof expression.value === 'string')
      return { unknown: false, values: new Set([expression.value]) }
    if (expression.type === 'TemplateLiteral' && expression.expressions.length === 0)
      return { unknown: false, values: new Set([expression.quasis[0]?.value?.cooked ?? '']) }
    if (expression.type === 'ConditionalExpression') {
      const branches = [expression.consequent, expression.alternate].map((branch) =>
        staticStringOptions(owner, branch, resolving, scope),
      )
      return {
        unknown: branches.some((branch) => branch.unknown),
        values: new Set(branches.flatMap((branch) => [...branch.values])),
      }
    }
    if (expression.type === 'CallExpression')
      return callKind(owner, expression.callee, scope) === 'computed'
        ? staticStringOptions(owner, returnedExpression(expression.arguments[0]), resolving, scope)
        : UNKNOWN_STRINGS
    const binding = expression.type === 'Identifier' ? constant(owner, expression, scope) : null
    return !binding || resolving.has(binding.variable)
      ? UNKNOWN_STRINGS
      : staticStringOptions(binding.owner, binding.init, new Set(resolving).add(binding.variable))
  }

  /** The values `identifier` can stand for, each with its file's provenance, or null. */
  function values(owner, identifier, scope) {
    const binding = bindings.bindingOf(owner, identifier, scope)
    const found = binding && bindings.valuesOf(binding)
    if (!found) return null
    return {
      key: binding.variable,
      values: found.map((value) => ({ node: value.node, provenance: provenanceFor(value.owner) })),
    }
  }

  /** The functions `callee` can name, each with its file's provenance, or null. */
  function callables(owner, callee, scope) {
    const found = bindings.callablesOf(owner, unwrapExpression(callee), scope)
    return (
      found?.map((entry) => ({ node: entry.node, provenance: provenanceFor(entry.owner) })) ?? null
    )
  }

  function ownerProvenance(owner) {
    return {
      ast: owner.ast,
      callKind: (callee, scope) => callKind(owner, callee, scope),
      callables: (callee, scope) => callables(owner, callee, scope),
      isToneInterpolation(node, scope) {
        const parts = interpolationParts(owner, node, scope)
        return parts.safe && parts.hasTone
      },
      kind: (node, scope) => provenanceKind(owner, node, new Set(), scope),
      staticString(node, scope) {
        const options = staticStringOptions(owner, node, new Set(), scope)
        return !options.unknown && options.values.size === 1 ? [...options.values][0] : null
      },
      staticStrings: (node, scope) => staticStringOptions(owner, node, new Set(), scope),
      values: (identifier, scope) => values(owner, identifier, scope),
    }
  }

  return {
    /** The provenance of one file of the tree, or null for a file it does not hold. */
    provenanceOf(file) {
      const owner = bindings.fileOf(file)
      return owner ? provenanceFor(owner) : null
    },
  }
}
