/**
 * Where the Volumes page's Done and Cancelled lead, held to one store's answers: the Work list the
 * number's address opens keeps exactly the cards the number counts, the page's label chosen or
 * not. The board and the two Volumes reads, whole and under the label `ui`, were asked for the
 * days 2026-11-12 to 2026-11-18 at UTC+03:00, where the reader here stands
 * (`tests/web_fixture_closed.py`). The goal finished in the period carries the label, which the
 * read under it does not count, since a filter of the page counts tasks alone.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { categoryTarget } from '@/pages/volumes/utils/volumesTargets.ts'

import { matchesWorkFilter, readWorkFilter } from '@/entities/work-item/utils/workFilter.ts'

import { validateReadModel } from '@/shared/api/planningModel.ts'
import type { OperatingScope } from '@/shared/api/platformRoute.ts'
import { validateVolumesAnswer } from '@/shared/api/volumesApi.ts'
import type { Volumes } from '@/shared/api/volumesReadApi.ts'

import { references } from './fixtures/board.ts'
import { readServerFixture } from './support/serverFixtures.ts'

afterEach(() => {
  vi.restoreAllMocks()
})

const SCOPE: OperatingScope = {
  kind: 'space',
  space_ref: { data_scope_id: '00000000-0000-4000-8000-000000000004', space_key: 'ALPHA' },
}
const DAYS = { period: 'custom', from: '2026-11-12', to: '2026-11-18' } as const

describe('Done and Cancelled on the Volumes page', () => {
  it('open the Work list whose cards are exactly the ones they count, with a label or none', () => {
    vi.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(-180)
    const fixture = readServerFixture('closed-in-period.json') as Record<string, unknown>
    const board = validateReadModel(fixture.board)
    const reads: [string | null, Volumes][] = [
      [null, validateVolumesAnswer(fixture.volumes)],
      ['ui', validateVolumesAnswer(fixture.volumes_labelled)],
    ]
    const listed: Record<string, string[]> = {}
    for (const [label, volumes] of reads) {
      for (const category of ['completed', 'cancelled'] as const) {
        const target = categoryTarget(SCOPE, category, { ...DAYS, kind: null, label })
        if (target.kind !== 'list') throw new Error(`${category} opens ${target.kind}`)
        expect(target.route.state?.view).toBe('list')
        const filter = readWorkFilter(target.route.state)
        const shown = references(
          board.work_items.filter((item) => matchesWorkFilter(item, filter)),
        ).toSorted()
        const row = volumes.counts.categories.find((each) => each.category === category)
        const counted = (row?.tasks ?? 0) + (row?.goals ?? 0) + (row?.stages ?? 0)
        expect(shown, `${category} under ${label ?? 'no label'}`).toHaveLength(counted)
        listed[`${category}:${label ?? ''}`] = shown
      }
    }
    // The cards themselves: the goal comes in only where no label narrows the page.
    expect(listed).toEqual({
      'completed:': ['ALPHA-1', 'ALPHA-3', 'ALPHA-6', 'ALPHA-7'],
      'cancelled:': ['ALPHA-5'],
      'completed:ui': ['ALPHA-1', 'ALPHA-7'],
      'cancelled:ui': ['ALPHA-5'],
    })
  })
})
