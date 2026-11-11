/**
 * The browser specs that write the system clipboard or are granted it, by file name under
 * `tests/browser`. A run of the allowed set (`npm run test:browser:allowed`) leaves them out
 * unless it names one, and `tests/clipboardSpecs.test.ts` fails when a spec that grants or
 * writes the clipboard, itself or through a module of the suite it imports, is missing here,
 * or when a name here is no longer a spec, which would let a renamed one back in.
 *
 * The list may hold more than the check finds, never less: `production-card-bar-press` and
 * `ui-document-links` replace the page's clipboard with one that keeps copies in the page,
 * which the check does not count as a write, and are listed all the same.
 */
export const clipboardSpecs: readonly string[] = [
  'production-card-bar-press.spec.ts',
  'production-card-notes.spec.ts',
  'production-card-source.spec.ts',
  'production-open-session.spec.ts',
  'production-reference-preview-copy.spec.ts',
  'ui-document-links.spec.ts',
]

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
    stale: listed.filter((name) => !specs.includes(name)),
    unlisted: specs.filter((name) => !listed.includes(name) && reachesClipboard(name, sources)),
  }
}
