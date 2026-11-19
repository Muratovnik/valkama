/**
 * A feature renders state through SemanticState or consumes a presentation tone
 * returned by uiSystem; it does not map a wire value to status colour locally.
 *
 * The scanner composes three syntax-owned analyses: exact uiSystem provenance,
 * every Vue selector/style carrier, and the component's CSS dependency graph.
 * It deliberately has no state-name or value allowlist. One register names the
 * components whose bound style copies paint the page already shows, read back
 * from it, rather than authoring any (`COPIED_PAINT`): they map no state to a
 * tone, so the presentation API has none to give them. Their selectors and
 * stylesheet are held to the rule as every other component's are.
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

/**
 * `file` → why its bound style copies paint the page shows rather than authoring it. A
 * registered file that is gone is refused, so the register says what the tree holds. Only the
 * product tree is scanned with it (`scanUiTree`); any other sources are scanned with none.
 */
export const COPIED_PAINT = new Map([
  [
    'shared/ui/WholeText.vue',
    'lays a cut text whole over itself in the ink of its first letter and on the ground under it, both read back from the page as it is drawn',
  ],
])

/** Reject any component-local route from operational state to semantic paint. */
export function scanSemanticStateOwnership(sources, copied = new Map()) {
  const violations = []
  const sourceByFile = new Map(sources.map(({ file, source }) => [file, source]))
  for (const file of copied.keys())
    if (!sourceByFile.has(file)) violations.push(`${file}: registered as copying paint, and gone`)
  for (const { file, source } of sources) {
    if (!file.endsWith('.vue')) continue
    const ast = parse(source, { parser: typescriptParser, sourceType: 'module' })
    const provenance = presentationProvenance(ast, source)
    const styles = localStyles(file, source, sourceByFile)
    if (cssDynamicPaintViolates(styles)) {
      violations.push(violation(file, 'a stylesheet v-bind authors a dynamic paint value'))
      continue
    }
    if (!copied.has(file) && inlineStyleViolates(ast.templateBody, provenance, styles)) {
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
