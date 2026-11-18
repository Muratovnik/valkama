/**
 * A card's title as runs: a work-item reference inside it is one run the head
 * keeps whole, because its hyphen is otherwise a place the line may break.
 */
import { describe, expect, it } from 'vitest'

import { titleRuns } from '@/entities/work-item/utils/titleRuns.ts'

describe('the runs of a card title', () => {
  it('cuts a reference out of the running text, and keeps every character', () => {
    const title = 'Findings after the review (follow-up to MAIN-384)'
    const runs = titleRuns(title)
    expect(runs).toEqual([
      { kind: 'text', text: 'Findings after the review (follow-up to ' },
      { kind: 'reference', text: 'MAIN-384' },
      { kind: 'text', text: ')' },
    ])
    expect(runs.map((run) => run.text).join('')).toBe(title)
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

  it('gives back the title character for character, backticks and spaces included', () => {
    for (const title of [
      'Draw `MAIN-12` and `code` as written',
      '  MAIN-1-MAIN-2 (main-3) `` ` tail  ',
      'Свести MAIN-1201, MAIN-1202 и docs/a-b.md',
    ])
      expect(
        titleRuns(title)
          .map((run) => run.text)
          .join(''),
      ).toBe(title)
  })
})
