/**
 * What a name in a component or a module is bound to, as the parser's scope
 * manager resolves it, and across `@/` imports into the module that declares it.
 *
 * A name is followed only where its binding cannot change: a `const`, a
 * function declaration, a property of a `const` destructured from a call whose
 * function returns object literals, and an import of a module in the tree. A
 * parameter, a `let`, a catch binding, a global and a module outside the tree
 * are bindings the guard cannot see into, and each analysis reads them as
 * unknown. So an attribute bag moved into a composable or a helper module is
 * read where it is written and held to the same rules as one written beside its
 * template; a name that some inner scope rebinds resolves to that inner binding,
 * not to a top-level one spelled the same.
 */

import { parser as typescriptParser } from 'typescript-eslint'
import { parseForESLint } from 'vue-eslint-parser'

import { resolveAliasTarget } from './imports.mjs'

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

export function unwrapExpression(node) {
  let current = node
  const wrappers =
    /^(?:Chain|Parenthesized|TSAs|TSInstantiation|TSNonNull|TSTypeAssertion)Expression$/u
  while (current && wrappers.test(current.type)) current = current.expression
  return current
}

const FUNCTION_TYPE = /^(?:ArrowFunction|Function)(?:Declaration|Expression)$/u

function childNodes(node) {
  const children = []
  for (const [key, value] of Object.entries(node)) {
    if (key === 'parent') continue
    if (Array.isArray(value)) children.push(...value)
    else if (value && typeof value === 'object') children.push(value)
  }
  return children
}

function collectReturns(node, root, returned) {
  if (!node || typeof node !== 'object') return
  if (node !== root && FUNCTION_TYPE.test(node.type)) return
  if (node.type === 'ReturnStatement') {
    if (node.argument) returned.push(node.argument)
    return
  }
  for (const child of childNodes(node)) collectReturns(child, root, returned)
}

/** What a function gives back: its expression body, or the argument of each of its own returns. */
export function returnExpressions(functionNode) {
  const body = unwrapExpression(functionNode)?.body
  if (!body) return []
  if (body.type !== 'BlockStatement') return [body]
  const returned = []
  collectReturns(body, body, returned)
  return returned
}

const isFunctionExpression = (node) =>
  /^(?:ArrowFunction|Function)Expression$/u.test(unwrapExpression(node)?.type)

function staticKey(property) {
  if (property.computed) return null
  if (property.key?.type === 'Identifier') return property.key.name
  if (property.key?.type === 'Literal' && typeof property.key.value === 'string')
    return property.key.value
  return null
}

function importName(specifier) {
  return specifier.imported?.name ?? specifier.imported?.value ?? null
}

/** The `<script setup>` text, the only script whose names a template reads. */
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

/** The key a destructured `const` takes its name from, or null for a shape the guard does not follow. */
function destructuredKey(pattern, name) {
  for (const property of pattern.properties) {
    if (property.type !== 'Property') continue
    if (property.value?.type === 'Identifier' && property.value.name === name)
      return staticKey(property)
  }
  return null
}

/**
 * One value binding: `const`, `function`, a destructured `const` or an import,
 * or null for every other kind. Type declarations sharing the name are left out.
 */
function declaredBinding(variable) {
  const definitions = variable?.defs.filter((definition) => definition.type !== 'Type') ?? []
  if (definitions.length !== 1) return null
  const [definition] = definitions
  if (definition.type === 'FunctionName' && definition.node.type === 'FunctionDeclaration')
    return { kind: 'function', node: definition.node }
  if (definition.type === 'ImportBinding') {
    const declaration = definition.parent
    const specifier = definition.node
    if (declaration?.importKind === 'type' || specifier.importKind === 'type') return null
    if (specifier.type !== 'ImportSpecifier') return null
    return { kind: 'import', source: declaration.source.value, imported: importName(specifier) }
  }
  if (definition.type !== 'Variable' || definition.parent?.kind !== 'const') return null
  const { id, init } = definition.node
  if (!init) return null
  if (id.type === 'Identifier') return { kind: 'const', init }
  if (id.type !== 'ObjectPattern') return null
  const key = destructuredKey(id, variable.name)
  return key === null ? null : { kind: 'destructured', init, key }
}

function referencesOf(scopeManager) {
  const references = new Map()
  for (const scope of scopeManager.scopes)
    for (const reference of scope.references) references.set(reference.identifier, reference)
  return references
}

/** `name.value = …` in the file's script, by the binding `name` resolves to. */
function refAssignments(ast, references, range) {
  const assignments = new Map()
  visitNodes(ast, (node) => {
    if (node.type !== 'AssignmentExpression' || node.operator !== '=') return
    if (!insideRange(node, range)) return
    const left = unwrapExpression(node.left)
    if (left?.type !== 'MemberExpression' || left.object?.type !== 'Identifier') return
    if (left.computed || left.property?.name !== 'value') return
    const variable = references.get(left.object)?.resolved
    if (!variable) return
    const entries = assignments.get(variable) ?? []
    entries.push(node.right)
    assignments.set(variable, entries)
  })
  return assignments
}

/** Whether `declaration`, the declaration an `export` carries, declares `name`. */
function declaresName(declaration, name) {
  if (declaration?.type === 'FunctionDeclaration') return declaration.id?.name === name
  if (declaration?.type !== 'VariableDeclaration') return false
  return declaration.declarations.some(
    (declarator) => declarator.id.type === 'Identifier' && declarator.id.name === name,
  )
}

/** What an `export { … }` statement exports as `name`: a local name, or one of another module. */
function exportedSpecifier(statement, name) {
  for (const specifier of statement.specifiers ?? []) {
    const exported = specifier.exported?.name ?? specifier.exported?.value
    if (exported !== name || specifier.exportKind === 'type') continue
    const local = specifier.local?.name ?? specifier.local?.value
    return statement.source ? { from: statement.source.value, name: local } : { local }
  }
  return null
}

function exportedVariable(program, moduleScope, name) {
  for (const statement of program.body) {
    if (statement.type !== 'ExportNamedDeclaration' || statement.exportKind === 'type') continue
    if (declaresName(statement.declaration, name)) return { variable: moduleScope.set.get(name) }
    const specifier = exportedSpecifier(statement, name)
    if (specifier?.from) return specifier
    if (specifier) return { variable: moduleScope.set.get(specifier.local) }
  }
  return null
}

/**
 * The value each return of `functionNode` gives the property `key`, or null
 * unless every return is an object literal that names it with no spread.
 */
function returnedProperty(functionNode, key) {
  const returned = returnExpressions(functionNode)
  if (returned.length === 0) return null
  const values = []
  for (const entry of returned) {
    const object = unwrapExpression(entry)
    if (object?.type !== 'ObjectExpression') return null
    if (object.properties.some((property) => property.type !== 'Property')) return null
    const match = object.properties.find((property) => staticKey(property) === key)
    if (!match) return null
    values.push(match.value)
  }
  return values
}

/**
 * Every file of the tree, parsed on first use, with what its names are bound
 * to. `isCanonical(source, imported)` names the imports that are read as what
 * they are, never followed into their module: `computed` and `ref` from Vue,
 * the presentation helpers of the UI system.
 */
export function bindingIndex(sourceByFile, isCanonical) {
  const files = new Map()
  const known = new Set(sourceByFile.keys())

  function fileOf(file) {
    if (files.has(file)) return files.get(file)
    const source = sourceByFile.get(file)
    if (source === undefined) return null
    const { ast, scopeManager } = parseForESLint(source, {
      parser: typescriptParser,
      sourceType: 'module',
      filePath: file,
    })
    const references = referencesOf(scopeManager)
    const moduleScope =
      scopeManager.scopes.find((scope) => scope.type === 'module') ?? scopeManager.globalScope
    const range = file.endsWith('.vue') ? setupScriptRange(source) : [0, source.length]
    const entry = {
      ast,
      file,
      moduleScope,
      range,
      references,
      assignments: refAssignments(ast, references, range),
    }
    files.set(file, entry)
    return entry
  }

  /** The binding `variable` holds in `owner`, an import followed to its declaration. */
  function bindingOfVariable(owner, variable, following = new Set()) {
    const binding = declaredBinding(variable)
    if (!binding) return null
    if (binding.kind !== 'import') return { ...binding, owner, variable }
    if (isCanonical(binding.source, binding.imported)) return { ...binding, owner, variable }
    return exportedBinding(binding.source, binding.imported, following)
  }

  function exportedBinding(specifier, name, following) {
    if (typeof specifier !== 'string' || !specifier.startsWith('@/') || name === null) return null
    const target = resolveAliasTarget(specifier.slice(2), known)
    const key = `${target}#${name}`
    if (!target || following.has(key)) return null
    const owner = fileOf(target)
    const found = owner && exportedVariable(owner.ast, owner.moduleScope, name)
    if (!found) return null
    const next = new Set(following).add(key)
    if (found.from) return exportedBinding(found.from, found.name, next)
    return found.variable ? bindingOfVariable(owner, found.variable, next) : null
  }

  /**
   * The binding of `identifier` in `owner`. `scope` is the template expression
   * the identifier stands in, or null for one in a script: a template name is a
   * `<script setup>` binding unless the template itself binds it (`v-for`, a
   * slot's props); a script name is whatever the scope manager resolves it to.
   */
  function bindingOf(owner, identifier, scope) {
    if (identifier?.type !== 'Identifier') return null
    if (!scope) {
      const variable = owner.references.get(identifier)?.resolved
      return variable ? bindingOfVariable(owner, variable) : null
    }
    const reference = scope.references?.find((entry) => entry.id === identifier)
    if (!reference || reference.variable) return null
    const variable = owner.moduleScope.set.get(identifier.name)
    const declared = variable?.defs.some((definition) => insideRange(definition.node, owner.range))
    return declared ? bindingOfVariable(owner, variable) : null
  }

  /**
   * The expressions a binding can stand for, each with the file it is written
   * in, or null when the guard cannot list them: a `const`'s initializer with
   * each `.value =` assignment to it, or a destructured property as each return
   * of the function it was destructured from writes it.
   */
  function valuesOf(binding, seen = new Set()) {
    if (!binding || seen.has(binding.variable)) return null
    if (binding.kind === 'const')
      return [binding.init, ...(binding.owner.assignments.get(binding.variable) ?? [])].map(
        (node) => ({ node, owner: binding.owner }),
      )
    if (binding.kind !== 'destructured') return null
    const call = unwrapExpression(binding.init)
    if (call?.type !== 'CallExpression') return null
    const next = new Set(seen).add(binding.variable)
    const functions = callablesOf(binding.owner, unwrapExpression(call.callee), null, next)
    if (!functions) return null
    const values = []
    for (const { node, owner } of functions) {
      const returned = returnedProperty(node, binding.key)
      if (!returned) return null
      values.push(...returned.map((value) => ({ node: value, owner })))
    }
    return values
  }

  /** The functions a callee can name, each with its file, or null when the guard cannot list them. */
  function callablesOf(owner, callee, scope, seen = new Set()) {
    const binding = bindingOf(owner, callee, scope)
    if (!binding) return null
    if (binding.kind === 'function') return [{ node: binding.node, owner: binding.owner }]
    const values = valuesOf(binding, seen)
    if (!values) return null
    const functions = []
    for (const value of values) {
      const node = unwrapExpression(value.node)
      if (isFunctionExpression(node)) functions.push({ node, owner: value.owner })
      else if (node?.type === 'Identifier') {
        const named = callablesOf(value.owner, node, null, new Set(seen).add(binding.variable))
        if (!named) return null
        functions.push(...named)
      } else return null
    }
    return functions
  }

  return { bindingOf, callablesOf, fileOf, valuesOf }
}
