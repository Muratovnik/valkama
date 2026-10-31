/**
 * A card's title as runs: a work-item reference inside it is one run the head
 * keeps whole, because its hyphen is otherwise a place the line may break.
 */
import { describe, expect, it } from 'vitest'

import { titleRuns } from '@/widgets/work-item-inspector/utils/titleRuns.ts'

describe('the runs of a card title', () => {
  it('cuts a reference out of the running text, and keeps every character', () => {
    const title = 'Findings after the review (follow-up to MAIN-384)'
    const runs = titleRuns(title)
    expect(runs).toEqual([
      { text: 'Findings after the review (follow-up to ', whole: false },
      { text: 'MAIN-384', whole: true },
      { text: ')', whole: false },
    ])
    expect(runs.map((run) => run.text).join('')).toBe(title)
  })

  it('finds every reference, at either end, and leaves an ordinary hyphen alone', () => {
    expect(titleRuns('MAIN-12 blocks MAIN-7').map((run) => [run.text, run.whole])).toEqual([
      ['MAIN-12', true],
      [' blocks ', false],
      ['MAIN-7', true],
    ])
    expect(titleRuns('A follow-up of a self-check')).toEqual([
      { text: 'A follow-up of a self-check', whole: false },
    ])
    expect(titleRuns('')).toEqual([])
  })
})
