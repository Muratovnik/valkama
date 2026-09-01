/**
 * A feature renders state through SemanticState or consumes a presentation tone
 * returned by uiSystem; it does not map a wire value to status colour locally.
 *
 * The scanner composes three syntax-owned analyses: exact uiSystem provenance,
 * every Vue selector/style carrier, and the component's CSS dependency graph.
 * It deliberately has no component, file, state-name, or value allowlist.
 */

import { parser as typescriptParser } from 'typescript-eslint'
import { parse } from 'vue-eslint-parser'

import { cssDynamicPaintViolates, localStyles, semanticStatusMarks } from './semantic-state-css.mjs'
import { inlineStyleViolates } from './semantic-state-inline-style.mjs'
import { presentationProvenance } from './semantic-state-provenance.mjs'
import { dynamicSelectorBindings } from './semantic-state-selectors.mjs'

function candidateMatches(candidate, value) {
  if (value === null || candidate.kind === 'any') return true
  if (candidate.kind === 'exact') return candidate.value === value
  return value.startsWith(candidate.value)
}

function isCanonicalToneCarrier(binding, candidate, value, tone) {
  return (
    binding.canonicalTarget &&
    binding.argument === 'data-tone' &&
    candidate.canonicalTone &&
    value === tone
  )
}

function classBindingViolates(binding, mark) {
  for (const name of mark.classes)
    for (const candidate of binding.candidates) {
      if (!candidateMatches(candidate, name)) continue
      if (!isCanonicalToneCarrier(binding, candidate, name, mark.tone)) return true
    }
  return false
}

function attributeBindingViolates(binding, mark) {
  const values = mark.attributes.get(binding.argument)
  if (!values) return false
  for (const value of values)
    for (const candidate of binding.candidates) {
      if (!candidateMatches(candidate, value)) continue
      if (!isCanonicalToneCarrier(binding, candidate, value, mark.tone)) return true
    }
  return false
}

function unknownBindingViolates(binding, mark) {
  if (classBindingViolates(binding, mark)) return true
  for (const values of mark.attributes.values())
    for (const value of values)
      for (const candidate of binding.candidates)
        if (candidateMatches(candidate, value)) return true
  return false
}

function bindingViolates(binding, mark) {
  if (binding.argument === 'class') return classBindingViolates(binding, mark)
  if (binding.argument === '*') return unknownBindingViolates(binding, mark)
  return attributeBindingViolates(binding, mark)
}

function violation(file, detail) {
  return `${file}: ${detail}; use SemanticState or a tone returned by the canonical uiSystem presentation API, and keep state-to-tone mapping in uiSystem.ts`
}

/** Reject any component-local route from operational state to semantic paint. */
export function scanSemanticStateOwnership(sources) {
  const violations = []
  const sourceByFile = new Map(sources.map(({ file, source }) => [file, source]))
  for (const { file, source } of sources) {
    if (!file.endsWith('.vue')) continue
    const ast = parse(source, { parser: typescriptParser, sourceType: 'module' })
    const provenance = presentationProvenance(ast, source)
    const styles = localStyles(file, source, sourceByFile)
    if (cssDynamicPaintViolates(styles)) {
      violations.push(violation(file, 'a stylesheet v-bind authors a dynamic paint value'))
      continue
    }
    if (inlineStyleViolates(ast.templateBody, provenance, styles)) {
      violations.push(violation(file, 'a bound style authors a dynamic paint value'))
      continue
    }

    const marks = semanticStatusMarks(styles)
    if (marks.length === 0) continue
    const bindings = dynamicSelectorBindings(ast.templateBody, provenance)
    if (!bindings.some((binding) => marks.some((mark) => bindingViolates(binding, mark)))) continue
    violations.push(
      violation(file, 'a dynamic selector carrier authors a local semantic status mark'),
    )
  }
  return violations
}
