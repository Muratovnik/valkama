/**
 * Which words of a text are candidate references, by shape alone.
 *
 * Whether a candidate is real is decided later by whoever renders it; what this
 * protects is that a candidate is found where an agent writes one and is not
 * invented inside a word, a path or a number.
 */
import { describe, expect, it } from 'vitest'

import { sameCommit } from '@/shared/lib/referenceLinks.ts'
import { splitReferences, wholeReference } from '@/shared/lib/textReferences.ts'

const values = (text: string) =>
  splitReferences(text).flatMap((run) => (typeof run === 'string' ? [] : [run.value]))

describe('candidate references', () => {
  it('keeps every character of the text, in order', () => {
    const text = 'Fixed MAIN-12 (see a1b2c3d), then MAIN-13/MAIN-14.'
    const runs = splitReferences(text)
    expect(runs.map((run) => (typeof run === 'string' ? run : run.value)).join('')).toBe(text)
    expect(values(text)).toEqual(['MAIN-12', 'a1b2c3d', 'MAIN-13', 'MAIN-14'])
  })

  it('finds a commit only as 7 to 40 hex characters holding a digit and a letter', () => {
    expect(values('a1b2c3d 0123456789abcdef0123456789abcdef01234567')).toEqual([
      'a1b2c3d',
      '0123456789abcdef0123456789abcdef01234567',
    ])
    // A number, an English hex word, a short hash and an uppercase one are not.
    expect(values('1234567 deadbeef facade a1b2c3 A1B2C3D')).toEqual([])
  })

  it('takes a repository-qualified commit by its hash, and no hash glued to a word or an extension', () => {
    expect(values('assay@89e5d4c')).toEqual(['89e5d4c'])
    expect(values('x89e5d4c a1b2c3d.ts a1b2c3d_old')).toEqual([])
  })

  it('finds item references by the planning grammar, and not inside a longer word', () => {
    expect(values('MAIN-12, MAIN-7.')).toEqual(['MAIN-12', 'MAIN-7'])
    expect(values('ui-MAIN-12 MAIN-0 MAIN-12x M-1')).toEqual([])
  })

  it('finds session UUIDs and AgentMemory ids', () => {
    expect(splitReferences('0f8fad5b-d9cb-469f-a165-70867728950e lsn_b66e8d69141aa297')).toEqual([
      { kind: 'session', value: '0f8fad5b-d9cb-469f-a165-70867728950e' },
      ' ',
      { kind: 'memory', value: 'lsn_b66e8d69141aa297' },
    ])
  })

  it('names the one reference a text is, and nothing for a text that holds more', () => {
    expect(wholeReference(' MAIN-12 ')).toEqual({ kind: 'work-item', value: 'MAIN-12' })
    expect(wholeReference('MAIN-12 MAIN-13')).toBeNull()
    expect(wholeReference('npm test')).toBeNull()
  })
})

describe('commit names', () => {
  it('are the same commit when one is a prefix of the other, from seven characters', () => {
    expect(sameCommit('a1b2c3d', 'a1b2c3d4e5f6')).toBe(true)
    expect(sameCommit('repo@a1b2c3d4', 'A1B2C3D')).toBe(true)
    expect(sameCommit('a1b2c3d', 'a1b2c3e')).toBe(false)
    expect(sameCommit('a1b2c3', 'a1b2c3d')).toBe(false)
  })

  // The same examples as tests/test_refs.py (CommitValueRuleTests), which hold
  // the server to this rule.
  it('compare the revision after a repository name, and a value without one whole', () => {
    expect(sameCommit('repo@a1b2c3d', 'a1b2c3d')).toBe(true)
    expect(sameCommit('my-repo a1b2c3d', 'a1b2c3d')).toBe(true)
    expect(sameCommit('a1b2c3d', 'a1b2c3d')).toBe(true)
    expect(sameCommit('HEAD@{1234567}', '{1234567}')).toBe(false)
    expect(sameCommit('HEAD@{1234567}', 'HEAD@{1234567}')).toBe(true)
    expect(sameCommit('-x@a1b2c3d', 'a1b2c3d')).toBe(false)
    expect(sameCommit('fix the bug', 'the bug')).toBe(false)
    expect(sameCommit('repo@--output=x', '--output=x')).toBe(true)
  })
})
