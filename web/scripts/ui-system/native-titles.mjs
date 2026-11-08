/**
 * A hint is the window's one tooltip (`v-tooltip`, `shared/ui/tooltipAnchors.ts`), never the
 * browser's `title`.
 *
 * The browser draws a `title` in its own font and colours, late, under the pointer alone and
 * never for a keyboard; the tooltip draws every hint in the product's words, on hover and on
 * focus. A hundred and twenty templates wrote `title` before the tooltip existed, so the next
 * template most likely will too.
 *
 * So a template may not give an element a `title`, written or bound. An element is an HTML or
 * SVG tag, or a component that declares no `title` prop: Vue passes the attribute through to the
 * component's root, where the browser shows it. A component's own `title` prop is its heading
 * and stays. A script may not set `title` either: `setAttribute('title', …)`, or `'title'` as a
 * key of the properties a render function gives an element. A slot's `title` is the slot's.
 *
 * A real exception is registered below by file, tag and attribute as written, with its reason;
 * a registered one that is gone is refused too, so the register says what the tree holds.
 */
import { compileScript, parse } from 'vue/compiler-sfc'

/** `file <tag> attribute` → why the browser's own tooltip is right there. */
export const NATIVE_TITLES = new Map()

const ELEMENT = 1
const IF = 9
const ELEMENT_TAG = 0
const COMPONENT_TAG = 1
const ATTRIBUTE = 6
const DIRECTIVE = 7

const COMPONENT_IMPORT = /import\s+(\w+)\s+from\s+['"]([^'"]+\.vue)['"]/g
const SCRIPT_TITLE = /setAttribute\(\s*['"]title['"]|(?<![\w$])['"]title['"]\s*:/g
/** A prop named `title` in a script the compiler could not read. */
const DECLARED_TITLE = /(?<![\w$.])title\??\s*:/

function titleOf(prop) {
  if (prop.type === ATTRIBUTE && prop.name === 'title') return prop
  const bound =
    prop.type === DIRECTIVE && prop.name === 'bind' && prop.arg?.isStatic && prop.arg.content
  return bound === 'title' ? prop : null
}

function* elementsOf(node) {
  if (node.type === ELEMENT) yield node
  for (const child of node.children ?? []) yield* elementsOf(child)
  for (const branch of node.type === IF ? node.branches : []) yield* elementsOf(branch)
}

/** Where an import of a component points, as a path below the source root. */
function resolved(file, path) {
  if (path.startsWith('@/')) return path.slice(2)
  if (!path.startsWith('.')) return null
  const parts = file.split('/').slice(0, -1)
  for (const part of path.split('/')) {
    if (part === '..') parts.pop()
    else if (part !== '.') parts.push(part)
  }
  return parts.join('/')
}

/** Whether a component declares a `title` prop, read as the compiler reads its props. */
function declaresTitle(descriptor) {
  try {
    return compileScript(descriptor, { id: descriptor.filename }).bindings?.title === 'props'
  } catch {
    // Props typed from another file: the declaration is read as written.
    const script = `${descriptor.script?.content ?? ''}${descriptor.scriptSetup?.content ?? ''}`
    return /defineProps/.test(script) && DECLARED_TITLE.test(script)
  }
}

const lineOf = (source, index) => source.slice(0, index).split('\n').length

/** The titles a script gives an element, each as the place it stands and what it says. */
function* scriptTitles(file, scripts) {
  for (const script of scripts)
    for (const match of script.content.matchAll(SCRIPT_TITLE))
      yield {
        line: script.loc.start.line + lineOf(script.content, match.index) - 1,
        what: `${file} script ${match[0]}`,
      }
}

/** The titles a template gives an element, or a component whose root takes them. */
function* templateTitles(file, descriptor, scripts, takesTitle) {
  const imports = new Map(
    scripts.flatMap(({ content }) =>
      [...content.matchAll(COMPONENT_IMPORT)].map(([, name, path]) => [name, resolved(file, path)]),
    ),
  )
  for (const element of elementsOf(descriptor.template.ast)) {
    const title = element.props.find((prop) => titleOf(prop))
    if (!title || ![COMPONENT_TAG, ELEMENT_TAG].includes(element.tagType)) continue
    const target = element.tagType === COMPONENT_TAG ? imports.get(element.tag) : null
    if (target && takesTitle(target)) continue
    yield { line: title.loc.start.line, what: `${file} <${element.tag}> ${title.loc.source}` }
  }
}

/** The components of the tree, and whether each declares a `title` prop, read once. */
function componentsOf(sources) {
  const descriptors = new Map()
  for (const { file, source } of sources)
    if (file.endsWith('.vue'))
      descriptors.set(file, parse(source, { filename: file, sourceMap: false }).descriptor)
  const titled = new Map()
  const takesTitle = (file) => {
    if (!descriptors.has(file)) return false
    if (!titled.has(file)) titled.set(file, declaresTitle(descriptors.get(file)))
    return titled.get(file)
  }
  return { descriptors, takesTitle }
}

/** Every title one file gives an element, in its scripts and its template. */
function titlesOf({ file, source }, { descriptors, takesTitle }) {
  const descriptor = descriptors.get(file)
  const scripts = descriptor
    ? [descriptor.script, descriptor.scriptSetup].filter(Boolean)
    : [{ content: source, loc: { start: { line: 1 } } }]
  const found = [...scriptTitles(file, scripts)]
  if (descriptor?.template?.ast)
    found.push(...templateTitles(file, descriptor, scripts, takesTitle))
  return found
}

export function scanNativeTitles(sources, register = NATIVE_TITLES) {
  const components = componentsOf(sources)
  const violations = []
  const seen = new Set()
  for (const entry of sources) {
    if (!/\.(?:ts|vue)$/.test(entry.file)) continue
    for (const { line, what } of titlesOf(entry, components))
      if (register.has(what)) seen.add(what)
      else
        violations.push(
          `${entry.file}:${line}: ${what.slice(entry.file.length + 1)} gives the browser's own tooltip; write v-tooltip (shared/ui/tooltipAnchors.ts), which every hint shares`,
        )
  }
  for (const what of register.keys())
    if (!seen.has(what)) violations.push(`${what}: registered as a native title, and gone`)
  return violations
}
