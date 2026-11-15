/**
 * The kind the work model retired for the goal and the stage is no word of the web app: no file
 * of its source or of its tests spells it, in any case, with no exception. Every place it lived —
 * the contract, the address keys, the lanes and frames, the colours, the texts — reads its
 * replacement, and a value of it an old address or a saved view still holds goes by the rule for
 * any value this build does not know, which needs no copy of the word.
 *
 * The word is put together here rather than written, so this file is read like any other.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const WEB = fileURLToPath(new URL('..', import.meta.url))
const RETIRED = new RegExp(['e', 'p', 'i', 'c'].join(''), 'iu')

/** Every file under a directory, as Git would read it: a file holding a NUL byte is binary. */
function textFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return textFiles(path)
    if (!entry.isFile()) return []
    return readFileSync(path).includes(0) ? [] : [path]
  })
}

describe('the retired kind of the goal and the stage', () => {
  it('is spelled by no file of the web source or its tests', () => {
    const files = ['src', 'tests'].flatMap((part) => textFiles(join(WEB, part)))
    // The walk reached what it is meant to read, this file among it.
    expect(files.length).toBeGreaterThan(1000)
    expect(files.map((path) => relative(WEB, path))).toContain(join('tests', 'retiredWord.test.ts'))
    const spelling = files
      .filter((path) => RETIRED.test(readFileSync(path, 'utf8')))
      .map((path) => relative(WEB, path).replaceAll('\\', '/'))
    expect(spelling).toEqual([])
  })
})
