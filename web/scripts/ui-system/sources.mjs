/** The source files every UI-system rule reads, and how their paths are named. */

export const defaultSourceRoot = fileURLToPath(new URL('../../src/', import.meta.url))

// VIcon owns the interface icon set. The brand mark is not one of them: it
// is a filled drawing in two colours that no icon font or stroke set can carry,
// and it exists once so the tab, the tray and the shell show the same one.

function normalizedRelative(root, file) {
  return relative(root, file).split(sep).join('/')
}

/**
 * Every source file under `root` a rule reads, with its path from there.
 *
 * A test reads the product tree with it as its file loads, outside its tests. Vitest
 * cannot stop a test whose body never awaits; it can only fail one that has returned,
 * by the time it took on the wall, and on a busy machine that time is the load beside
 * the run rather than the reading. Loading a file has no such limit, and a read or a
 * rule that throws there still fails the file.
 */
export function collectVueSources(root = defaultSourceRoot) {
  const sources = []
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const target = join(directory, entry.name)
      if (entry.isDirectory()) visit(target)
      else if (entry.isFile() && /\.(?:vue|css|ts)$/.test(entry.name)) {
        sources.push({
          file: normalizedRelative(root, target),
          source: readFileSync(target, 'utf8'),
        })
      }
    }
  }
  visit(root)
  return sources.sort((left, right) => left.file.localeCompare(right.file))
}

/**
 * The rules that hold for one file, as data.
 *
 * `owners` is the set of files that legitimately author the thing the pattern
 * finds; `markup` is the source with comments stripped, so a rule about what the
 * interface renders is not tripped by a comment describing it.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
