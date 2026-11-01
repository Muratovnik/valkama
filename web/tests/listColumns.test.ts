/**
 * Which list columns give way to the title, and in what order, as the list
 * narrows: state, priority and holder first, then steps and date; never the
 * reference or the title.
 */
import { describe, expect, it } from 'vitest'

import { fitFor, isFolded, LIST_COLUMNS } from '@/widgets/work-item-views/utils/listColumns.ts'

const standing = (width: number) =>
  LIST_COLUMNS.filter((column) => !isFolded(fitFor(width), column.key)).map((column) => column.key)

describe('the list columns as the list narrows', () => {
  it('stand all seven in a desktop-wide list, and when the width is not yet known', () => {
    expect(standing(1106)).toHaveLength(7)
    expect(standing(0)).toHaveLength(7)
  })

  it('fold the state, the priority and the holder first, keeping the steps and the date', () => {
    expect(standing(703)).toEqual(['reference', 'title', 'checklist', 'updated'])
  })

  it('leave the reference and the title on a phone', () => {
    expect(standing(292)).toEqual(['reference', 'title'])
  })
})
