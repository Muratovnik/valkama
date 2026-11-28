import { basename } from 'node:path'

/**
 * The browser specs that use the system clipboard, by file name under `tests/browser`: each is
 * granted it and reads back what a page put there, which only the browser's own clipboard can
 * show. `playwright.config.ts` does not select them unless `clipboardOptIn` is `1`, so a bare
 * `npx playwright test` leaves them out; a run of the allowed set (`npm run test:browser:allowed`)
 * sets it only when it names one.
 *
 * Every other spec runs with the page's clipboard (`pageClipboard.ts`), which the suite's `test`
 * puts into each context such a spec opens: what its pages copy stays in the page, and a grant of
 * the system clipboard fails there. So a test that needs the system clipboard goes into a listed
 * spec of its own, as each `-clipboard` spec holds the few tests of the spec beside it that do,
 * and the list names those specs and no others.
 *
 * `tests/clipboardSpecs.test.ts` fails when a spec that grants or writes the clipboard, itself or
 * through a module of the suite it imports, is missing here, when a name here is no longer a spec,
 * which would let a renamed one back in, when a spec here does neither, so it runs on the system
 * clipboard for nothing, and when a spec takes its `test` from anywhere but the suite's, which
 * would leave its pages the system clipboard.
 */
export const clipboardSpecs: readonly string[] = [
  'production-analytics-quota-account-actions-clipboard.spec.ts',
  'production-card-source-clipboard.spec.ts',
  'production-open-session-clipboard.spec.ts',
  'production-reference-preview-copy-clipboard.spec.ts',
  'production-title-code-copy.spec.ts',
]

/**
 * The spec of the page's clipboard itself, which writes it and asks for the system's, to show
 * that the one keeps the writes and the other is refused: it stays off the list, since what it
 * checks is how a spec off the list behaves.
 */
export const pageClipboardSpec = 'ui-page-clipboard.spec.ts'

/** Whether the spec at `file`, a path or a name, uses the system clipboard: it is listed. */
export function usesSystemClipboard(file: string): boolean {
  return clipboardSpecs.includes(basename(file))
}

/** The variable that lets a Playwright run select the specs above: `1` and nothing else. */
export const clipboardOptIn = 'VALKAMA_BROWSER_CLIPBOARD'

/**
 * The configuration's `testIgnore`: each listed spec by its file name, unless the environment
 * opts in. Playwright matches it against a file's absolute path, so a run that names such a
 * spec, or lists the suite, does not reach it either.
 */
export function clipboardIgnore(env: Readonly<Record<string, string | undefined>>): RegExp[] {
  return env[clipboardOptIn] === '1'
    ? []
    : clipboardSpecs.map((name) => new RegExp(`(?:^|[\\\\/])${literal(name)}$`))
}

/** A file name as a RegExp that matches it and nothing else. */
function literal(name: string): string {
  return name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** A grant of clipboard access, or a call that writes it; a stub's `writeText:` is neither. */
const clipboardUse = /\bclipboard-(?:read|write)\b|\bclipboard\.write(?:Text)?\s*\(/

/** The suite's own modules a source imports, by file name: `from './name.ts'`. */
function suiteImports(source: string): string[] {
  return [...source.matchAll(/(?:from|import) '\.\/([\w.-]+\.ts)'/g)].map(([, name]) => name)
}

/** Whether `file`, or a module of the suite it reaches through its imports, uses the clipboard. */
function reachesClipboard(
  file: string,
  sources: ReadonlyMap<string, string>,
  seen = new Set<string>(),
): boolean {
  if (seen.has(file)) return false
  seen.add(file)
  const source = sources.get(file) ?? ''
  return (
    clipboardUse.test(source) ||
    suiteImports(source).some((name) => reachesClipboard(name, sources, seen))
  )
}

/** What the list misses and what it names in vain. */
export interface ClipboardListGaps {
  /** Listed specs that neither grant nor write the clipboard, so they need no system clipboard. */
  needless: string[]
  /** Listed names that are no spec among the sources. */
  stale: string[]
  /** Specs that grant or write the clipboard and are not listed. */
  unlisted: string[]
}

/**
 * Compares the list with the suite. `sources` maps each `.ts` file under `tests/browser`,
 * by file name, to its text, so the imports a spec makes can be followed.
 */
export function clipboardListGaps(
  sources: ReadonlyMap<string, string>,
  listed: readonly string[] = clipboardSpecs,
): ClipboardListGaps {
  const specs = [...sources.keys()].filter((name) => name.endsWith('.spec.ts'))
  return {
    needless: listed.filter((name) => specs.includes(name) && !reachesClipboard(name, sources)),
    stale: listed.filter((name) => !specs.includes(name)),
    unlisted: specs.filter(
      (name) =>
        !listed.includes(name) && name !== pageClipboardSpec && reachesClipboard(name, sources),
    ),
  }
}

/** What one `import … from '<module>'` of a source binds. */
interface Imported {
  module: string
  /** The names it imports between braces, as the module exports them. */
  named: string[]
  /** A default or namespace binding: the module's whole `test` among what it gives. */
  whole: boolean
}

/** Each value import of `source`; `import type` binds no value and is left out. */
function importsOf(source: string): Imported[] {
  // The clause stops at a quote, so it never runs on into an earlier import's module.
  return [...source.matchAll(/^import\s+(?!type\s)([^'"]+?)\s+from\s+'([^']+)'/gmu)].map(
    ([, clause = '', module = '']) => {
      const braces = /\{([^}]*)\}/u.exec(clause)?.[1] ?? ''
      const outside = clause.replace(/\{[^}]*\}/u, '').trim()
      return {
        module,
        named: braces
          .split(',')
          .map((one) => one.trim())
          .filter((one) => one !== '' && !one.startsWith('type '))
          .map((one) => /^[\w$]+/u.exec(one)?.[0] ?? ''),
        whole: /^(?:[\w$]|\*\s*as\s)/u.test(outside),
      }
    },
  )
}

/**
 * The specs among `sources`, as `clipboardListGaps` takes them, that do not take their `test`
 * from the suite's (`test.ts`) alone: the suite's is imported by name, since it has no default
 * export, and anything that binds Playwright's own, by name, by default or as a namespace, leaves
 * a page the system clipboard.
 */
export function specsWithoutSuiteTest(sources: ReadonlyMap<string, string>): string[] {
  return [...sources]
    .filter(([name]) => name.endsWith('.spec.ts'))
    .filter(([, source]) => {
      const imports = importsOf(source)
      const suite = imports.some(
        ({ module, named }) => module === './test.ts' && named.includes('test'),
      )
      const playwright = imports.some(
        ({ module, whole, named }) =>
          module === '@playwright/test' && (whole || named.includes('test')),
      )
      return !suite || playwright
    })
    .map(([name]) => name)
}
