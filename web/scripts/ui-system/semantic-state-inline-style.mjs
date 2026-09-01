import {
  cssDeclarations,
  normalizeStyleProperty,
  paintCustomProperties,
  SEMANTIC_MARK_PROPERTY,
} from './semantic-state-css.mjs'
import { identifierIsShadowed, unwrapExpression, visitNodes } from './semantic-state-provenance.mjs'

function childNodes(node) {
  const children = []
  for (const [key, value] of Object.entries(node)) {
    if (key === 'parent') continue
    if (Array.isArray(value)) children.push(...value)
    else if (value && typeof value === 'object') children.push(value)
  }
  return children
}

function isNestedFunction(node, root) {
  return node !== root && /^(?:ArrowFunction|Function)(?:Declaration|Expression)$/u.test(node.type)
}

function collectReturns(node, root, returned) {
  if (!node || typeof node !== 'object' || isNestedFunction(node, root)) return
  if (node.type === 'ReturnStatement') {
    if (node.argument) returned.push(node.argument)
    return
  }
  for (const child of childNodes(node)) collectReturns(child, root, returned)
}

function returnExpressions(functionNode) {
  const body = unwrapExpression(functionNode)?.body
  if (!body) return []
  if (body.type !== 'BlockStatement') return [body]
  const returned = []
  collectReturns(body, body, returned)
  return returned
}

function localFunction(callee, context) {
  if (callee?.type !== 'Identifier') return null
  const declaration = context.functions.get(callee.name)
  if (declaration) return declaration
  const definition = unwrapExpression(context.definitions.get(callee.name))
  return /^(?:ArrowFunction|Function)Expression$/u.test(definition?.type) ? definition : null
}

function mergeStyleShapes(shapes) {
  return {
    entries: shapes.flatMap((shape) => shape.entries),
    unknown: shapes.some((shape) => shape.unknown),
  }
}

function staticPropertyName(property, provenance, scope) {
  if (property.computed) return provenance.staticString(property.key, scope)
  if (property.key?.type === 'Identifier') return property.key.name
  if (property.key?.type === 'Literal' && typeof property.key.value === 'string')
    return property.key.value
  return null
}

function objectStyleShape(expression, provenance, scope, resolving) {
  const shapes = []
  const entries = []
  let unknown = false
  for (const property of expression.properties) {
    if (property.type === 'SpreadElement') {
      shapes.push(styleShape(property.argument, provenance, scope, resolving))
      continue
    }
    const name = staticPropertyName(property, provenance, scope)
    if (name === null) unknown = true
    else entries.push({ property: normalizeStyleProperty(name), scope, value: property.value })
  }
  const merged = mergeStyleShapes(shapes)
  return { entries: [...entries, ...merged.entries], unknown: unknown || merged.unknown }
}

function literalStyleShape(expression, scope) {
  if (typeof expression.value !== 'string') return { entries: [], unknown: false }
  return {
    entries: cssDeclarations(expression.value).map((entry) => ({
      property: normalizeStyleProperty(entry.property),
      scope,
      value: { type: 'Literal', value: entry.value },
    })),
    unknown: false,
  }
}

function identifierStyleShape(expression, provenance, scope, resolving) {
  if (expression.name === 'undefined') return { entries: [], unknown: false }
  if (identifierIsShadowed(expression, scope) || resolving.has(expression.name))
    return { entries: [], unknown: true }
  const definition = provenance.context.definitions.get(expression.name)
  if (!definition) return { entries: [], unknown: true }
  const next = new Set(resolving).add(expression.name)
  return mergeStyleShapes([
    styleShape(definition, provenance, null, next),
    ...(provenance.context.assignments.get(expression.name) ?? []).map((assignment) =>
      styleShape(assignment, provenance, null, next),
    ),
  ])
}

function callStyleShape(expression, provenance, scope, resolving) {
  const callee = unwrapExpression(expression.callee)
  if (callee?.type === 'Identifier' && provenance.context.computed.has(callee.name))
    return mergeStyleShapes(
      returnExpressions(expression.arguments[0]).map((returned) =>
        styleShape(returned, provenance, scope, resolving),
      ),
    )
  if (callee?.type === 'Identifier' && provenance.context.refs.has(callee.name))
    return styleShape(expression.arguments[0], provenance, scope, resolving)
  const callable = localFunction(callee, provenance.context)
  if (!callable || resolving.has(callee.name)) return { entries: [], unknown: true }
  const returned = returnExpressions(callable)
  if (returned.length === 0) return { entries: [], unknown: true }
  const next = new Set(resolving).add(callee.name)
  return mergeStyleShapes(returned.map((entry) => styleShape(entry, provenance, null, next)))
}

function styleShape(node, provenance, scope, resolving = new Set()) {
  const expression = unwrapExpression(node)
  if (!expression) return { entries: [], unknown: false }
  switch (expression.type) {
    case 'ArrayExpression': {
      return mergeStyleShapes(
        expression.elements.map((entry) => styleShape(entry, provenance, scope, resolving)),
      )
    }
    case 'ConditionalExpression': {
      return mergeStyleShapes([
        styleShape(expression.consequent, provenance, scope, resolving),
        styleShape(expression.alternate, provenance, scope, resolving),
      ])
    }
    case 'LogicalExpression': {
      return styleShape(expression.right, provenance, scope, resolving)
    }
    case 'ObjectExpression': {
      return objectStyleShape(expression, provenance, scope, resolving)
    }
    case 'Literal': {
      return literalStyleShape(expression, scope)
    }
    case 'Identifier': {
      return identifierStyleShape(expression, provenance, scope, resolving)
    }
    case 'CallExpression': {
      return callStyleShape(expression, provenance, scope, resolving)
    }
    default: {
      return { entries: [], unknown: true }
    }
  }
}

function styleValueIsStatic(node, provenance, scope, resolving = new Set()) {
  const expression = unwrapExpression(node)
  if (!expression || expression.type === 'Literal') return true
  if (expression.type === 'TemplateLiteral')
    return expression.expressions.every((entry) =>
      styleValueIsStatic(entry, provenance, scope, resolving),
    )
  if (expression.type === 'ArrayExpression')
    return expression.elements.every((entry) =>
      styleValueIsStatic(entry, provenance, scope, resolving),
    )
  if (expression.type === 'ObjectExpression')
    return expression.properties.every(
      (property) =>
        property.type !== 'SpreadElement' &&
        styleValueIsStatic(property.value, provenance, scope, resolving),
    )
  if (expression.type === 'Identifier') {
    if (expression.name === 'undefined') return true
    if (identifierIsShadowed(expression, scope) || resolving.has(expression.name)) return false
    const definition = provenance.context.definitions.get(expression.name)
    return Boolean(
      definition &&
      styleValueIsStatic(definition, provenance, null, new Set(resolving).add(expression.name)),
    )
  }
  if (expression.type === 'ConditionalExpression')
    return [expression.test, expression.consequent, expression.alternate].every((entry) =>
      styleValueIsStatic(entry, provenance, scope, resolving),
    )
  if (expression.type === 'UnaryExpression')
    return styleValueIsStatic(expression.argument, provenance, scope, resolving)
  return false
}

function mergeAttributeShapes(shapes) {
  return {
    styles: shapes.flatMap((shape) => shape.styles),
    unknown: shapes.some((shape) => shape.unknown),
  }
}

function attributePropertyTargets(property, provenance, scope) {
  if (property.computed) return provenance.staticStrings(property.key, scope)
  const name = staticPropertyName(property, provenance, scope)
  return { unknown: name === null, values: new Set(name === null ? [] : [name]) }
}

function objectAttributeShape(expression, provenance, scope, resolving) {
  const shapes = []
  const styles = []
  for (const property of expression.properties) {
    if (property.type === 'SpreadElement') {
      shapes.push(attributeBagShape(property.argument, provenance, scope, resolving))
      continue
    }
    const targets = attributePropertyTargets(property, provenance, scope)
    if (targets.unknown || [...targets.values].some((target) => target.toLowerCase() === 'style'))
      styles.push({ expression: property.value, scope })
  }
  const merged = mergeAttributeShapes(shapes)
  return { styles: [...styles, ...merged.styles], unknown: merged.unknown }
}

function identifierAttributeShape(expression, provenance, scope, resolving) {
  if (expression.name === 'undefined') return { styles: [], unknown: false }
  if (identifierIsShadowed(expression, scope) || resolving.has(expression.name))
    return { styles: [], unknown: true }
  const definition = provenance.context.definitions.get(expression.name)
  if (!definition) return { styles: [], unknown: true }
  const next = new Set(resolving).add(expression.name)
  return mergeAttributeShapes([
    attributeBagShape(definition, provenance, null, next),
    ...(provenance.context.assignments.get(expression.name) ?? []).map((assignment) =>
      attributeBagShape(assignment, provenance, null, next),
    ),
  ])
}

function callAttributeShape(expression, provenance, scope, resolving) {
  const callee = unwrapExpression(expression.callee)
  if (callee?.type === 'Identifier' && provenance.context.computed.has(callee.name)) {
    const returned = returnExpressions(expression.arguments[0])
    if (returned.length === 0) return { styles: [], unknown: true }
    return mergeAttributeShapes(
      returned.map((entry) => attributeBagShape(entry, provenance, scope, resolving)),
    )
  }
  if (callee?.type === 'Identifier' && provenance.context.refs.has(callee.name))
    return attributeBagShape(expression.arguments[0], provenance, scope, resolving)
  const callable = localFunction(callee, provenance.context)
  if (!callable || resolving.has(callee.name)) return { styles: [], unknown: true }
  const returned = returnExpressions(callable)
  if (returned.length === 0) return { styles: [], unknown: true }
  const next = new Set(resolving).add(callee.name)
  return mergeAttributeShapes(
    returned.map((entry) => attributeBagShape(entry, provenance, null, next)),
  )
}

function attributeBagShape(node, provenance, scope, resolving = new Set()) {
  const expression = unwrapExpression(node)
  if (!expression) return { styles: [], unknown: true }
  switch (expression.type) {
    case 'ObjectExpression': {
      return objectAttributeShape(expression, provenance, scope, resolving)
    }
    case 'ConditionalExpression': {
      return mergeAttributeShapes([
        attributeBagShape(expression.consequent, provenance, scope, resolving),
        attributeBagShape(expression.alternate, provenance, scope, resolving),
      ])
    }
    case 'LogicalExpression': {
      const branches = [attributeBagShape(expression.right, provenance, scope, resolving)]
      if (expression.operator !== '&&')
        branches.push(attributeBagShape(expression.left, provenance, scope, resolving))
      return mergeAttributeShapes(branches)
    }
    case 'Identifier': {
      return identifierAttributeShape(expression, provenance, scope, resolving)
    }
    case 'CallExpression': {
      return callAttributeShape(expression, provenance, scope, resolving)
    }
    case 'Literal': {
      return expression.value === null || expression.value === false
        ? { styles: [], unknown: false }
        : { styles: [], unknown: true }
    }
    default: {
      return { styles: [], unknown: true }
    }
  }
}

function bindTargets(attribute, provenance) {
  const argument = attribute.key?.argument
  if (argument?.type === 'VIdentifier') return { unknown: false, values: new Set([argument.name]) }
  if (argument?.type === 'VExpressionContainer')
    return provenance.staticStrings(argument.expression, argument)
  return { unknown: true, values: new Set() }
}

function boundStyleExpressions(template, provenance) {
  const expressions = []
  let unknown = false
  visitNodes(template, (node) => {
    if (node.type !== 'VAttribute' || !node.directive || node.key?.name?.name !== 'bind') return
    const expression = node.value?.expression
    if (!node.key.argument) {
      const shape = attributeBagShape(expression, provenance, node.value)
      expressions.push(...shape.styles)
      unknown ||= shape.unknown
      return
    }
    const targets = bindTargets(node, provenance)
    if (targets.unknown || [...targets.values].some((target) => target.toLowerCase() === 'style'))
      expressions.push({ expression, scope: node.value })
  })
  return { expressions, unknown }
}

export function inlineStyleViolates(template, provenance, css) {
  const paintProperties = paintCustomProperties(css)
  const bindings = boundStyleExpressions(template, provenance)
  if (bindings.unknown) return true
  for (const binding of bindings.expressions) {
    const shape = styleShape(binding.expression, provenance, binding.scope)
    if (shape.unknown) return true
    for (const entry of shape.entries) {
      const isPaint =
        SEMANTIC_MARK_PROPERTY.test(entry.property) || paintProperties.has(entry.property)
      if (isPaint && !styleValueIsStatic(entry.value, provenance, entry.scope)) return true
    }
  }
  return false
}
