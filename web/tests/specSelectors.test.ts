/**
 * A selector on a class nothing writes matches nothing.
 *
 * A check of such a selector's absence cannot fail and a check of its presence cannot pass, and
 * neither says so: the class was renamed or removed in the product and the spec kept asking for
 * it. So every class a test under `browser/`, `components/` or `support/` names in a selector has
 * to be written somewhere a test can render it — the app's sources and page, the browser harness,
 * or the test file itself — and a use that is not is refused, unless a list below still names it.
 *
 * The scan reads text, so "written" means the name appears in that text as a whole word, or is
 * one a template there can compose, keeping its fixed parts, as `module-${…}` composes
 * `module-planning`. It cannot prove a class is rendered; it proves that a class appearing nowhere
 * cannot be.
 */

import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { test } from 'vitest'

interface Source {
  file: string
  text: string
}

interface Gaps {
  stale: string[]
  unregistered: string[]
}

const REPAIRED_BY_FIX = "check of a class removed from the product; repaired by the group's fix"

/**
 * The dead uses still awaiting repair, as `<file under web/tests> .<class>`, in file order so a
 * repair removes whole lines. An entry whose use is gone is refused as stale: the list only shrinks.
 */
const DEAD_USES = new Map<string, string>([
  ['browser/production-analytics-changes.spec.ts .period-markers', REPAIRED_BY_FIX],
  ['browser/production-analytics-changes.spec.ts .period-notes', REPAIRED_BY_FIX],
  ['browser/production-analytics-changes.spec.ts .period-readout', REPAIRED_BY_FIX],
  ['browser/production-analytics-marks.spec.ts .period-readout', REPAIRED_BY_FIX],
  ['browser/production-analytics-marks.spec.ts .step-readout', REPAIRED_BY_FIX],
  ['browser/production-analytics-steady.spec.ts .period-readout', REPAIRED_BY_FIX],
  ['browser/ui-charts.spec.ts .period-readout', REPAIRED_BY_FIX],
  ['browser/ui-charts.spec.ts .step-readout', REPAIRED_BY_FIX],
  ['components/analyticsQuota.spec.ts .quota-account-head', REPAIRED_BY_FIX],
])

/** Where the classes a library writes at runtime begin; no source of this app names them. */
const LIBRARY_PREFIXES = ['lucide-', 'reka-', 'vue-flow__'] as const

/** The library classes a test selects, each with what writes it. */
const LIBRARY_CLASSES = new Map<string, string>([
  ['vue-flow__edges', 'Vue Flow writes it at runtime on the layer that holds the edges'],
  ['vue-flow__node-card', 'Vue Flow writes it at runtime on a node of the card type'],
  ['vue-flow__node-frame', 'Vue Flow writes it at runtime on a node of the frame type'],
])

const web = fileURLToPath(new URL('../', import.meta.url))
const suite = join(web, 'tests')

function read(root: string, directory: string, keep: (name: string) => boolean): Source[] {
  return readdirSync(join(root, directory), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && keep(entry.name))
    .map((entry) => {
      const path = join(entry.parentPath, entry.name)
      return { file: relative(root, path).split(sep).join('/'), text: readFileSync(path, 'utf8') }
    })
    .sort((left, right) => left.file.localeCompare(right.file))
}

/** The test files whose selectors are read, named from `web/tests`. */
function testSources(): Source[] {
  return ['browser', 'components', 'support'].flatMap((directory) =>
    read(suite, directory, (name) => name.endsWith('.ts')),
  )
}

/** Everything a test can render: the app's sources and page, and the browser harness. */
function corpusText(): string {
  const app = read(web, 'src', (name) => /\.(?:vue|ts|css|html)$/u.test(name))
  const harness = readdirSync(join(suite, 'browser'))
    .filter((name) => /^harness|Surface\.ts$|\.vue$/u.test(name))
    .map((name) => readFileSync(join(suite, 'browser', name), 'utf8'))
  const page = readFileSync(join(web, 'index.html'), 'utf8')
  return [...app.map(({ text }) => text), page, ...harness].join('\n')
}

const STRING = /(['"`])((?:\\.|(?!\1).)*)\1/gu
const CLASS = /(?<![\w-])\.([a-z][\w-]*)/gu
const SELECTOR_CALL =
  /(?<![\w$])(?:locator|querySelectorAll|querySelector|closest|matches|get|findAll|find|\$\$|\$|waitForSelector)\(\s*$/u
const FILE_EXTENSIONS = new Set(
  'css html js json log md mjs png spec svg test ts txt vue woff woff2'.split(' '),
)

/** A literal is a selector when it is handed to a selector call or reads as one rather than prose. */
function isSelector(literal: string, before: string): boolean {
  return SELECTOR_CALL.test(before) || !/\s/u.test(literal) || /[[:>#,+~]/u.test(literal)
}

/** A token such as `.json`, or the stem of a file name such as `.package-lock.json`. */
function isFileName(name: string, after: string): boolean {
  const extension = /^\.(\w+)(?![\w-])/u.exec(after)?.[1]
  return FILE_EXTENSIONS.has(name) || (extension !== undefined && FILE_EXTENSIONS.has(extension))
}

/** A class a template composes: a fixed head such as `step-`, then its parts and interpolations. */
const TEMPLATE_CLASS = /(?<![\w$-])[a-z][\w-]*-\$\{[^{}]*\}(?:[\w-]|\$\{[^{}]*\})*/gu

/**
 * The classes the corpus composes from templates, each as the pattern of the names it can write:
 * its fixed text stays and each `${…}` stands for letters, digits or hyphens. So `step-${kind}-mark`
 * writes `step-ring-mark` and never `step-readout`, which a head alone would let through.
 */
function composedClasses(corpus: string): RegExp[] {
  const patterns = new Set<string>()
  for (const [template] of corpus.matchAll(TEMPLATE_CLASS))
    patterns.add(template.split(/\$\{[^{}]*\}/u).join(String.raw`[\w-]+`))
  return [...patterns].map((pattern) => new RegExp(`^${pattern}$`, 'u'))
}

/** The classes a line's selector literals name; a call broken before its literal is on `previous`. */
function selectorClasses(line: string, previous: string): string[] {
  if (/^\s*(?:\*|\/\/|\/\*)/u.test(line)) return []
  const names: string[] = []
  for (const match of line.matchAll(STRING)) {
    const literal = match[2] ?? ''
    const ahead = line.slice(0, match.index)
    if (!isSelector(literal, (ahead.trim() === '' ? previous : ahead).trimEnd())) continue
    for (const found of literal.matchAll(CLASS)) {
      const name = found[1] ?? ''
      const after = literal.slice(found.index + found[0].length)
      // A name called, as `).getUTCHours()` in a template's interpolation, is a method.
      if (!after.startsWith('(') && !isFileName(name, after)) names.push(name)
    }
  }
  return names
}

/** Each use of a class that nothing a test can render writes, as `<file> .<class>` → its lines. */
function deadUses(sources: readonly Source[], corpus: string): Map<string, number[]> {
  if (sources.length === 0) throw new Error('the scan read no test files')
  if (corpus.trim() === '') throw new Error('the scan read an empty corpus')
  const written = new Set(corpus.match(/[\w-]+/gu))
  const composed = composedClasses(corpus)
  const isComposed = (name: string) =>
    name.endsWith('-') || composed.some((pattern) => pattern.test(name))
  const uses = new Map<string, number[]>()
  for (const { file, text } of sources) {
    // A class the file writes itself, in a stub's template or a `class` it sets, is a bare word.
    const bare = text.replaceAll(/(?<![\w-])\.[a-z][\w-]*/gu, ' ')
    const own = new Set(bare.match(/(?<![\w.-])[a-z][\w-]*/gu))
    const lines = text.split('\n')
    for (const [index, line] of lines.entries()) {
      for (const name of selectorClasses(line, lines[index - 1] ?? '')) {
        if (written.has(name) || own.has(name) || isComposed(name)) continue
        const key = `${file} .${name}`
        uses.set(key, [...(uses.get(key) ?? []), index + 1])
      }
    }
  }
  return uses
}

const classOf = (key: string) => key.slice(key.lastIndexOf(' .') + 2)

/** What the uses and the two lists disagree on, both ways. */
function registerGaps(
  uses: ReadonlyMap<string, number[]>,
  register: ReadonlyMap<string, string> = DEAD_USES,
  library: ReadonlyMap<string, string> = LIBRARY_CLASSES,
): Gaps {
  const unregistered = [...uses]
    .filter(([key]) => !register.has(key) && !library.has(classOf(key)))
    .map(
      ([key, lines]) =>
        `${key} (line ${lines.join(', ')}): selects a class nothing writes; select by a contract hook`,
    )
  const selected = new Set([...uses.keys()].map((key) => classOf(key)))
  const stale = [
    ...[...register.keys()]
      .filter((key) => !uses.has(key))
      .map((key) => `${key}: registered as a dead use, and gone`),
    ...[...library.keys()]
      .filter((name) => !selected.has(name))
      .map((name) => `.${name}: allowed as a library class, and no test selects it`),
  ]
  return { stale, unregistered }
}

const without = <T>(map: ReadonlyMap<string, T>, key: string) =>
  new Map([...map].filter(([entry]) => entry !== key))

test('every class the tests select is written, or still listed with its reason', () => {
  assert.deepEqual(registerGaps(deadUses(testSources(), corpusText())), {
    stale: [],
    unregistered: [],
  })
})

test('the register is in file order, and the allowance holds library classes only', () => {
  const keys = [...DEAD_USES.keys()]
  assert.deepEqual(
    keys,
    keys.toSorted((left, right) => left.localeCompare(right)),
  )
  for (const name of LIBRARY_CLASSES.keys())
    assert.ok(
      LIBRARY_PREFIXES.some((prefix) => name.startsWith(prefix)),
      `${name}: not a class a library writes`,
    )
})

test('a class nothing writes is reported, and one the app writes is not', () => {
  const spec = {
    file: 'browser/synthetic.spec.ts',
    text: [
      "await expect(page.locator('.no-such-class-x')).toHaveCount(0)",
      "await expect(page.locator('.one-line')).toBeVisible()",
    ].join('\n'),
  }
  assert.deepEqual(
    deadUses([spec], corpusText()),
    new Map([['browser/synthetic.spec.ts .no-such-class-x', [1]]]),
  )
})

test('what a test writes itself, a composed class, a file name, prose and a comment are not uses', () => {
  const corpus = '<p class="written"></p><nav :class="`module-${id}`"></nav>'
  const spec = {
    file: 'components/synthetic.spec.ts',
    text: [
      'const Stub = { template: \'<i class="stub-row" />\' }',
      "expect(wrapper.find('.stub-row').exists()).toBe(true)",
      "await page.locator('.module-planning').click()",
      "readFileSync('node_modules/.package-lock.json')",
      "test('hides .ghost-row once the list is empty', () => {})",
      "// expect(page.locator('.gone-in-comment')).toHaveCount(0)",
      "expect(page.locator('.written')).toBeVisible()",
      'const pair = page.locator(',
      "  '.ghost-a .ghost-b',",
      ')',
    ].join('\n'),
  }
  assert.deepEqual(
    deadUses([spec], corpus),
    new Map([
      ['components/synthetic.spec.ts .ghost-a', [9]],
      ['components/synthetic.spec.ts .ghost-b', [9]],
    ]),
  )
})

test('a template covers only the names it can write, and a called name is no class', () => {
  const corpus = '<i :class="`step-${kind}-mark`"></i>'
  const spec = {
    file: 'browser/synthetic.spec.ts',
    text: [
      "await page.locator('.step-ring-mark').hover()",
      "await expect(page.locator('.step-readout')).toHaveCount(0)",
      "const at = `${String(new Date(0).getUTCHours()).padStart(2, '0')}:00`",
    ].join('\n'),
  }
  assert.deepEqual(
    deadUses([spec], corpus),
    new Map([['browser/synthetic.spec.ts .step-readout', [2]]]),
  )
})

test('the scan refuses an empty domain', () => {
  const spec = { file: 'browser/a.spec.ts', text: "page.locator('.a')" }
  assert.throws(() => deadUses([], corpusText()), /read no test files/u)
  assert.throws(() => deadUses([spec], ' \n'), /read an empty corpus/u)
})

test('either list fails both ways: on a use it leaves out and on an entry that is gone', () => {
  const uses = deadUses(testSources(), corpusText())
  const [site = ''] = DEAD_USES.keys()
  const [library = ''] = LIBRARY_CLASSES.keys()
  const left = registerGaps(uses, without(DEAD_USES, site)).unregistered
  assert.ok(
    left.some((line) => line.startsWith(`${site} (line`)),
    left.join('\n'),
  )
  const fake = new Map([...DEAD_USES, ['browser/gone.spec.ts .gone-class', REPAIRED_BY_FIX]])
  assert.deepEqual(registerGaps(uses, fake).stale, [
    'browser/gone.spec.ts .gone-class: registered as a dead use, and gone',
  ])
  const unallowed = registerGaps(uses, DEAD_USES, without(LIBRARY_CLASSES, library)).unregistered
  assert.ok(
    unallowed.some((line) => line.includes(` .${library} (line`)),
    unallowed.join('\n'),
  )
  const allowed = new Map([...LIBRARY_CLASSES, ['vue-flow__gone', 'a fake entry']])
  assert.deepEqual(registerGaps(uses, DEAD_USES, allowed).stale, [
    '.vue-flow__gone: allowed as a library class, and no test selects it',
  ])
})
