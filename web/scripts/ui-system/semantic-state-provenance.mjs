const UI_SYSTEM_SOURCE = '@/shared/lib/uiSystem.ts'
const PRESENTATION_HELPERS = new Set(['semanticStatePresentation', 'statePresentation'])

/** Visit a tree when every match matters rather than only the first one. */
export function visitNodes(node, visitor) {
  if (!node || typeof node !== 'object') return
  visitor(node)
  for (const [key, value] of Object.entries(node)) {
    if (key === 'parent') continue
    if (Array.isArray(value)) {
      for (const entry of value) visitNodes(entry, visitor)
    } else if (value && typeof value === 'object') {
      visitNodes(value, visitor)
    }
  }
}

function namedProperty(node) {
  if (!node) return null
  if (!node.computed && node.property?.type === 'Identifier') return node.property.name
  if (node.computed && node.property?.type === 'Literal') return node.property.value
  return null
}

export function unwrapExpression(node) {
  let current = node
  const wrappers =
    /^(?:Chain|Parenthesized|TSAs|TSInstantiation|TSNonNull|TSTypeAssertion)Expression$/u
  while (current && wrappers.test(current.type)) current = current.expression
  return current
}

function returnedExpression(callback) {
  const body = unwrapExpression(callback)?.body
  return body?.type === 'BlockStatement' ? null : body
}

function importName(specifier) {
  return specifier.imported?.name ?? specifier.imported?.value ?? null
}

function registerImport(context, source, specifier) {
  if (specifier.importKind === 'type' || specifier.type !== 'ImportSpecifier') return
  if (source === UI_SYSTEM_SOURCE && PRESENTATION_HELPERS.has(importName(specifier)))
    context.helpers.add(specifier.local.name)
  if (source === 'vue' && importName(specifier) === 'computed')
    context.computed.add(specifier.local.name)
  if (source === 'vue' && importName(specifier) === 'ref') context.refs.add(specifier.local.name)
}

function registerProgramStatement(context, statement) {
  if (statement.type === 'ImportDeclaration' && statement.importKind !== 'type') {
    for (const specifier of statement.specifiers)
      registerImport(context, statement.source.value, specifier)
    return
  }
  if (statement.type === 'FunctionDeclaration' && statement.id)
    context.functions.set(statement.id.name, statement)
  if (statement.type !== 'VariableDeclaration' || statement.kind !== 'const') return
  for (const declaration of statement.declarations)
    if (declaration.init && declaration.id.type === 'Identifier')
      context.definitions.set(declaration.id.name, declaration.init)
}

function setupScriptRange(source) {
  const open = /<script\b[^>]*\bsetup\b[^>]*>/iu.exec(source)
  if (!open) return null
  const start = open.index + open[0].length
  const close = source.indexOf('</script>', start)
  return close < 0 ? null : [start, close]
}

function insideRange(node, range) {
  return Boolean(range && node.range?.[0] >= range[0] && node.range?.[1] <= range[1])
}

function provenanceContext(program, source) {
  const context = {
    assignments: new Map(),
    computed: new Set(),
    definitions: new Map(),
    functions: new Map(),
    helpers: new Set(),
    refs: new Set(),
  }
  const setupRange = setupScriptRange(source)
  for (const statement of program.body)
    if (insideRange(statement, setupRange)) registerProgramStatement(context, statement)
  visitNodes(program, (node) => {
    if (!insideRange(node, setupRange)) return
    if (node.type !== 'AssignmentExpression' || node.operator !== '=') return
    const left = unwrapExpression(node.left)
    if (
      left?.type !== 'MemberExpression' ||
      left.object?.type !== 'Identifier' ||
      namedProperty(left) !== 'value'
    )
      return
    const entries = context.assignments.get(left.object.name) ?? []
    entries.push(node.right)
    context.assignments.set(left.object.name, entries)
  })
  return context
}

function patternBinds(pattern, name) {
  if (!pattern) return false
  if (pattern.type === 'Identifier') return pattern.name === name
  if (pattern.type === 'RestElement') return patternBinds(pattern.argument, name)
  if (pattern.type === 'AssignmentPattern') return patternBinds(pattern.left, name)
  if (pattern.type === 'ArrayPattern')
    return pattern.elements.some((element) => patternBinds(element, name))
  if (pattern.type === 'ObjectPattern')
    return pattern.properties.some((property) =>
      property.type === 'RestElement'
        ? patternBinds(property.argument, name)
        : patternBinds(property.value, name),
    )
  return false
}

/** A canonical import name is not canonical when a lexical binding owns it. */
export function identifierIsShadowed(identifier, scope) {
  if (identifier?.type !== 'Identifier') return false
  if (scope) {
    const reference = scope.references?.find((entry) => entry.id === identifier)
    if (!reference || reference.variable) return true
  }
  let current = identifier.parent
  while (current && current !== scope) {
    if (
      /^(?:ArrowFunction|Function)Expression$/u.test(current.type) &&
      current.params.some((parameter) => patternBinds(parameter, identifier.name))
    )
      return true
    if (current.type === 'CatchClause' && patternBinds(current.param, identifier.name)) return true
    current = current.parent
  }
  return false
}

function callProvenance(expression, context, resolving, scope) {
  const callee = unwrapExpression(expression.callee)
  if (
    callee?.type === 'Identifier' &&
    context.helpers.has(callee.name) &&
    !identifierIsShadowed(callee, scope)
  )
    return 'presentation'
  const isComputed =
    callee?.type === 'Identifier' &&
    context.computed.has(callee.name) &&
    !identifierIsShadowed(callee, scope)
  return isComputed
    ? provenanceKind(returnedExpression(expression.arguments[0]), context, resolving, scope)
    : null
}

function provenanceKind(node, context, resolving = new Set(), scope = null) {
  const expression = unwrapExpression(node)
  if (!expression) return null
  if (expression.type === 'CallExpression')
    return callProvenance(expression, context, resolving, scope)
  if (expression.type === 'Identifier') {
    if (identifierIsShadowed(expression, scope)) return null
    const definition = context.definitions.get(expression.name)
    if (!definition || resolving.has(expression.name)) return null
    return provenanceKind(definition, context, new Set(resolving).add(expression.name), null)
  }
  if (expression.type === 'MemberExpression') {
    const owner = provenanceKind(expression.object, context, resolving, scope)
    return namedProperty(expression) === 'tone' && owner === 'presentation' ? 'tone' : null
  }
  return null
}

function interpolationParts(node, context, scope) {
  const expression = unwrapExpression(node)
  if (!expression) return { hasTone: false, safe: false }
  if (provenanceKind(expression, context, new Set(), scope) === 'tone')
    return { hasTone: true, safe: true }
  if (expression.type === 'Literal' && typeof expression.value === 'string')
    return { hasTone: false, safe: true }
  let nodes = null
  if (expression.type === 'TemplateLiteral') nodes = expression.expressions
  else if (expression.type === 'BinaryExpression' && expression.operator === '+')
    nodes = [expression.left, expression.right]
  if (!nodes) return { hasTone: false, safe: false }
  const parts = nodes.map((entry) => interpolationParts(entry, context, scope))
  return {
    hasTone: parts.some((part) => part.hasTone),
    safe: parts.every((part) => part.safe),
  }
}

function staticStringOptions(node, context, resolving = new Set(), scope = null) {
  const expression = unwrapExpression(node)
  if (!expression) return { unknown: true, values: new Set() }
  if (expression.type === 'Literal' && typeof expression.value === 'string')
    return { unknown: false, values: new Set([expression.value]) }
  if (expression.type === 'TemplateLiteral' && expression.expressions.length === 0)
    return { unknown: false, values: new Set([expression.quasis[0]?.value?.cooked ?? '']) }
  if (expression.type === 'ConditionalExpression') {
    const branches = [expression.consequent, expression.alternate].map((branch) =>
      staticStringOptions(branch, context, resolving, scope),
    )
    return {
      unknown: branches.some((branch) => branch.unknown),
      values: new Set(branches.flatMap((branch) => [...branch.values])),
    }
  }
  if (expression.type === 'CallExpression') {
    const callee = unwrapExpression(expression.callee)
    if (
      callee?.type === 'Identifier' &&
      context.computed.has(callee.name) &&
      !identifierIsShadowed(callee, scope)
    )
      return staticStringOptions(
        returnedExpression(expression.arguments[0]),
        context,
        resolving,
        scope,
      )
  }
  if (expression.type !== 'Identifier' || identifierIsShadowed(expression, scope))
    return { unknown: true, values: new Set() }
  const definition = context.definitions.get(expression.name)
  if (!definition || resolving.has(expression.name)) return { unknown: true, values: new Set() }
  return staticStringOptions(definition, context, new Set(resolving).add(expression.name), null)
}

export function presentationProvenance(program, source) {
  const context = provenanceContext(program, source)
  return {
    context,
    isToneInterpolation(node, scope) {
      const parts = interpolationParts(node, context, scope)
      return parts.safe && parts.hasTone
    },
    kind: (node, scope) => provenanceKind(node, context, new Set(), scope),
    staticString(node, scope) {
      const options = staticStringOptions(node, context, new Set(), scope)
      return !options.unknown && options.values.size === 1 ? [...options.values][0] : null
    },
    staticStrings: (node, scope) => staticStringOptions(node, context, new Set(), scope),
  }
}
