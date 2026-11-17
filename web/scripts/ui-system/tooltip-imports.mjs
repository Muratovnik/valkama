/**
 * Every template that writes `v-tooltip` imports the directive it names.
 *
 * The directive is no global one: a template reaches it through the `vTooltip` its script imports
 * from `shared/ui/tooltipAnchors.ts`, as `<script setup>` names a directive. Without the import Vue
 * resolves `v-tooltip` to nothing, warns in development alone and draws the element with no hint;
 * the type check passes, and the built app drew a crossed table's headings and the Analytics
 * bar's sign-only «Add a filter» without the hints their templates gave them.
 */
import { parse } from 'vue/compiler-sfc'

/** The directive as a template writes it: with its kind, its argument or its value. */
const WRITTEN = /\bv-tooltip(?=[.:=\s/>])/u
const IMPORTED =
  /\bimport\s*\{[^}]*\bvTooltip\b[^}]*\}\s*from\s*['"][^'"]*\/tooltipAnchors(?:\.ts)?['"]/u
const COMMENT = /<!--[\s\S]*?-->/gu

/** The template with its comments blanked, so a comment about the directive is not the directive. */
const markupOf = (content) =>
  content.replaceAll(COMMENT, (comment) => comment.replaceAll(/[^\n]/gu, ' '))

export function scanTooltipImports(sources) {
  const violations = []
  for (const { file, source } of sources) {
    if (!file.endsWith('.vue')) continue
    const { descriptor } = parse(source, { filename: file, sourceMap: false })
    if (!descriptor.template) continue
    const markup = markupOf(descriptor.template.content)
    const written = WRITTEN.exec(markup)
    if (!written) continue
    const scripts = [descriptor.script, descriptor.scriptSetup].filter(Boolean)
    if (scripts.some((script) => IMPORTED.test(script.content))) continue
    const line =
      descriptor.template.loc.start.line + markup.slice(0, written.index).split('\n').length - 1
    violations.push(
      `${file}:${line}: the template writes v-tooltip and its script imports no vTooltip from shared/ui/tooltipAnchors.ts; the directive is no global one, and without the import the element draws no hint`,
    )
  }
  return violations
}
