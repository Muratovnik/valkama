import { visitNodes } from './semantic-state-provenance.mjs'

function addCandidate(candidates, kind, value, canonicalTone = false) {
  candidates.push({ canonicalTone, kind, value })
}

function selectorArgument(argument) {
  return typeof argument === 'string' ? argument.toLowerCase() : argument
}

function staticClassName(node) {
  if (node?.type === 'Identifier') return node.name
  if (node?.type === 'Literal' && typeof node.value === 'string') return node.value
  return null
}

function dynamicClassPrefix(node) {
  if (node.type === 'TemplateLiteral') return node.quasis[0]?.value?.cooked ?? ''
  if (node.type !== 'BinaryExpression' || node.operator !== '+') return ''
  if (node.left?.type === 'Literal' && typeof node.left.value === 'string') return node.left.value
  return dynamicClassPrefix(node.left)
}

function addDynamicOutput(node, candidates, environment) {
  const fixed = staticClassName(node)
  if (fixed !== null) {
    for (const name of fixed.split(/\s+/u)) if (name) addCandidate(candidates, 'exact', name)
    return
  }
  if (node?.type === 'ConditionalExpression') {
    addDynamicOutput(node.consequent, candidates, environment)
    addDynamicOutput(node.alternate, candidates, environment)
    return
  }
  const prefix = node && dynamicClassPrefix(node)
  if (prefix) {
    addCandidate(
      candidates,
      'prefix',
      prefix,
      environment.provenance.isToneInterpolation(node, environment.scope),
    )
  } else {
    addCandidate(
      candidates,
      'any',
      '',
      environment.provenance.kind(node, environment.scope) === 'tone',
    )
  }
}

function collectObjectProperty(property, candidates) {
  if (property.type === 'SpreadElement' || property.computed) {
    addCandidate(candidates, 'any', '')
    return
  }
  if (property.value?.type === 'Literal') return
  const name = staticClassName(property.key)
  if (name === null) addCandidate(candidates, 'any', '')
  else addCandidate(candidates, 'exact', name)
}

function collectInterpolatedValue(node, candidates, environment) {
  const prefix = dynamicClassPrefix(node)
  if (prefix)
    addCandidate(
      candidates,
      'prefix',
      prefix,
      environment.provenance.isToneInterpolation(node, environment.scope),
    )
  else
    addCandidate(
      candidates,
      'any',
      '',
      environment.provenance.kind(node, environment.scope) === 'tone',
    )
}

function collectDynamicClassValues(node, candidates, environment) {
  if (!node || typeof node !== 'object') return
  switch (node.type) {
    case 'ArrayExpression': {
      for (const element of node.elements)
        collectDynamicClassValues(element, candidates, environment)
      break
    }
    case 'ObjectExpression': {
      for (const property of node.properties) collectObjectProperty(property, candidates)
      break
    }
    case 'ConditionalExpression': {
      addDynamicOutput(node.consequent, candidates, environment)
      addDynamicOutput(node.alternate, candidates, environment)
      break
    }
    case 'LogicalExpression': {
      addDynamicOutput(node.right, candidates, environment)
      if (node.operator !== '&&') addCandidate(candidates, 'any', '')
      break
    }
    case 'TemplateLiteral': {
      if (node.expressions.length > 0) collectInterpolatedValue(node, candidates, environment)
      break
    }
    case 'BinaryExpression': {
      if (node.operator === '+') collectInterpolatedValue(node, candidates, environment)
      break
    }
    case 'Literal': {
      break
    }
    default: {
      addCandidate(
        candidates,
        'any',
        '',
        environment.provenance.kind(node, environment.scope) === 'tone',
      )
    }
  }
}

function collectBoundAttributeValues(node, candidates, environment) {
  if (!node || node.type === 'Literal') return
  if (node.type === 'ConditionalExpression') {
    addDynamicOutput(node.consequent, candidates, environment)
    addDynamicOutput(node.alternate, candidates, environment)
    return
  }
  if (
    node.type === 'TemplateLiteral' ||
    (node.type === 'BinaryExpression' && node.operator === '+')
  ) {
    collectInterpolatedValue(node, candidates, environment)
    return
  }
  addCandidate(
    candidates,
    'any',
    '',
    environment.provenance.kind(node, environment.scope) === 'tone',
  )
}

function selectorArguments(attribute, provenance) {
  const argument = attribute.key?.argument
  if (!argument) return { exact: false, unknown: true, values: new Set() }
  if (argument.type === 'VIdentifier')
    return { exact: true, unknown: false, values: new Set([argument.name]) }
  if (argument.type === 'VExpressionContainer')
    return { ...provenance.staticStrings(argument.expression, argument), exact: false }
  return { exact: false, unknown: true, values: new Set() }
}

function collectUnknownSelectorValues(value, candidates, environment) {
  if (environment.includeFixed && value?.type === 'Literal' && typeof value.value === 'string') {
    for (const name of value.value.split(/\s+/u)) if (name) addCandidate(candidates, 'exact', name)
    return
  }
  collectDynamicClassValues(value, candidates, environment)
}

function addSelectorBinding(environment, argument, value, options = {}) {
  const normalizedArgument = selectorArgument(argument)
  const candidates = []
  const collector = { ...environment, includeFixed: options.includeFixed ?? false }
  if (normalizedArgument === 'class') collectDynamicClassValues(value, candidates, collector)
  else if (normalizedArgument !== null) collectBoundAttributeValues(value, candidates, collector)
  else if (normalizedArgument === null) collectUnknownSelectorValues(value, candidates, collector)
  if (collector.includeFixed && candidates.length === 0 && value?.type === 'Literal')
    addCandidate(candidates, 'exact', String(value.value))
  if (candidates.length > 0)
    environment.bindings.push({
      argument: normalizedArgument ?? '*',
      candidates,
      canonicalTarget: options.canonicalTarget ?? true,
    })
}

function barePropertyName(property, environment) {
  if (property.type === 'SpreadElement') return null
  if (!property.computed) return staticClassName(property.key)
  return environment.provenance.staticString(property.key, environment.scope)
}

function collectComputedBareProperty(property, environment) {
  const targets = environment.provenance.staticStrings(property.key, environment.scope)
  const dynamicTarget = targets.unknown || targets.values.size > 1
  for (const target of targets.values)
    if (selectorArgument(target) !== 'style')
      addSelectorBinding(environment, target, property.value, {
        canonicalTarget: !dynamicTarget,
        includeFixed: dynamicTarget,
      })
  if (targets.unknown)
    addSelectorBinding(environment, null, property.value, {
      canonicalTarget: false,
      includeFixed: true,
    })
}

function collectBareProperty(property, environment) {
  if (property.type === 'SpreadElement') {
    addSelectorBinding(environment, null, property.argument, {
      canonicalTarget: false,
      includeFixed: true,
    })
    return
  }
  const argument = barePropertyName(property, environment)
  if (argument === null) collectComputedBareProperty(property, environment)
  else if (selectorArgument(argument) !== 'style')
    addSelectorBinding(environment, argument, property.value)
}

function collectBareBind(expression, environment) {
  if (expression?.type !== 'ObjectExpression') {
    addSelectorBinding(environment, null, expression, {
      canonicalTarget: false,
      includeFixed: true,
    })
    return
  }
  for (const property of expression.properties) collectBareProperty(property, environment)
}

function collectAttribute(attribute, bindings, provenance) {
  const expression = attribute.value?.expression
  const environment = { bindings, provenance, scope: attribute.value }
  if (!attribute.key.argument) {
    collectBareBind(expression, environment)
    return
  }
  const targets = selectorArguments(attribute, provenance)
  const dynamicTarget = targets.unknown || targets.values.size > 1
  for (const argument of targets.values)
    if (selectorArgument(argument) !== 'style')
      addSelectorBinding(environment, argument, expression, {
        canonicalTarget: targets.exact || !dynamicTarget,
        includeFixed: dynamicTarget,
      })
  if (targets.unknown)
    addSelectorBinding(environment, null, expression, {
      canonicalTarget: false,
      includeFixed: true,
    })
}

/** Every selector carrier, including object-form and dynamic-argument v-bind. */
export function dynamicSelectorBindings(template, provenance) {
  const bindings = []
  visitNodes(template, (node) => {
    if (node.type === 'VAttribute' && node.directive && node.key?.name?.name === 'bind')
      collectAttribute(node, bindings, provenance)
  })
  return bindings
}
