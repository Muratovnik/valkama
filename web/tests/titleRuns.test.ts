/**
 * A card's title as runs. A work-item reference inside it is one run the surface keeps whole,
 * because its hyphen is otherwise a place the line may break; code written between backticks is
 * one run drawn as code, without them (`titleRuns.ts`). Written back, the runs are the title as
 * it was written, backticks included; read as drawn, they are its words without the backticks.
 */
import { describe, expect, it } from 'vitest'

import { referencedTitleRuns, titleRuns } from '@/shared/lib/titleRuns.ts'
import { drawnText, writtenText } from '@/shared/ui/textRuns.ts'

describe('the runs of a card title', () => {
  it('cuts a reference out of the running text, and keeps every character', () => {
    const title = 'Findings after the review (follow-up to MAIN-384)'
    const runs = titleRuns(title)
    expect(runs).toEqual([
      { kind: 'text', text: 'Findings after the review (follow-up to ' },
      { kind: 'reference', text: 'MAIN-384' },
      { kind: 'text', text: ')' },
    ])
    expect(writtenText(runs)).toBe(title)
  })

  it('finds every reference, at either end, and leaves an ordinary hyphen alone', () => {
    expect(titleRuns('MAIN-12 blocks MAIN-7').map((run) => [run.text, run.kind])).toEqual([
      ['MAIN-12', 'reference'],
      [' blocks ', 'text'],
      ['MAIN-7', 'reference'],
    ])
    expect(titleRuns('A follow-up of a self-check')).toEqual([
      { kind: 'text', text: 'A follow-up of a self-check' },
    ])
    expect(titleRuns('')).toEqual([])
  })

  it('draws a pair of backticks with something between them as one code run, without them', () => {
    const title = 'Raise `STORE_SCHEMA_VERSION` to 18'
    expect(titleRuns(title)).toEqual([
      { kind: 'text', text: 'Raise ' },
      { kind: 'code', text: 'STORE_SCHEMA_VERSION' },
      { kind: 'text', text: ' to 18' },
    ])
    expect(drawnText(titleRuns(title))).toBe('Raise STORE_SCHEMA_VERSION to 18')
  })

  it('keeps code at either end, and two pairs written together as two runs', () => {
    expect(titleRuns('`npm ci` then `npm test`')).toEqual([
      { kind: 'code', text: 'npm ci' },
      { kind: 'text', text: ' then ' },
      { kind: 'code', text: 'npm test' },
    ])
    expect(titleRuns('`left``right`')).toEqual([
      { kind: 'code', text: 'left' },
      { kind: 'code', text: 'right' },
    ])
  })

  it('leaves a backtick without a partner, and an empty pair, as the text they are', () => {
    expect(titleRuns('Odd ` count')).toEqual([{ kind: 'text', text: 'Odd ` count' }])
    expect(titleRuns('An empty `` pair')).toEqual([{ kind: 'text', text: 'An empty `` pair' }])
    // Pairs are taken from the left: the empty pair is one, and the next two make code.
    expect(titleRuns('`` then `x` and ` tail')).toEqual([
      { kind: 'text', text: '`` then ' },
      { kind: 'code', text: 'x' },
      { kind: 'text', text: ' and ` tail' },
    ])
  })

  it('keeps a reference or a path inside code as code', () => {
    expect(titleRuns('Rename `MAIN-12` in `web/src/app-shell/main.ts`')).toEqual([
      { kind: 'text', text: 'Rename ' },
      { kind: 'code', text: 'MAIN-12' },
      { kind: 'text', text: ' in ' },
      { kind: 'code', text: 'web/src/app-shell/main.ts' },
    ])
  })

  it('gives back the title character for character, backticks and spaces included', () => {
    for (const title of [
      'Draw `MAIN-12` and `code` as written',
      '  MAIN-1-MAIN-2 (main-3) `` ` tail  ',
      'Свести MAIN-1201, MAIN-1202 и docs/a-b.md',
      '`a``b` `` ` `c d` MAIN-4`',
      '` `',
    ])
      expect(writtenText(titleRuns(title))).toBe(title)
  })

  it('puts a reference before its title on one line, written as «reference · title»', () => {
    const runs = referencedTitleRuns('MAIN-3', 'Bump `VERSION`')
    expect(runs).toEqual([
      { kind: 'reference', text: 'MAIN-3' },
      { kind: 'text', text: ' · ' },
      { kind: 'text', text: 'Bump ' },
      { kind: 'code', text: 'VERSION' },
    ])
    expect(writtenText(runs)).toBe('MAIN-3 · Bump `VERSION`')
  })
})
