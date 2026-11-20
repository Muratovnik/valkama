/**
 * The filter's condition «Closed in a period»: a card completed or cancelled within the period,
 * whole days of the reader's calendar. Which cards it keeps; that on one store's answers it keeps
 * exactly the cards the Volumes read counts as Done and as Cancelled for the period, with the
 * state category beside it; how it rides the address, which the planning manifest admits; and
 * what its chip and its periods are called.
 */
import assert from 'node:assert/strict'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { filterGroups, stepGroups, tokenName } from '@/features/work-filter/filterOptions.ts'

import type { ClosedPeriod } from '@/entities/work-item/utils/closedPeriod.ts'
import {
  filterRouteState,
  matchesWorkFilter,
  readsEveryFilterValue,
  readWorkFilter,
  toggleToken,
  writeWorkFilter,
} from '@/entities/work-item/utils/workFilter.ts'
import type { WorkFilter } from '@/entities/work-item/utils/workFilter.ts'

import { validateReadModel } from '@/shared/api/planningModel.ts'
import type { WorkItemBrief } from '@/shared/api/planningModel.ts'
import { OFFLINE_MODULE_FALLBACK } from '@/shared/api/platformModules.ts'
import { validateManifestRouteState } from '@/shared/api/platformRoute.ts'
import { validateVolumesAnswer } from '@/shared/api/volumesApi.ts'

import { boardItem, references } from './fixtures/board.ts'
import { readServerFixture } from './support/serverFixtures.ts'
import { i18n } from './support/workItemBoardHarness.ts'

/** Thursday 19 November 2026, noon, on the reader's own clock. */
const NOW = new Date(2026, 10, 19, 12)
/** A moment on the reader's own clock, as the server writes one. */
const at = (day: number, hours = 12, minutes = 0, seconds = 0) =>
  new Date(2026, 10, day, hours, minutes, seconds).toISOString()

const done = (n: number, closed: string, overrides: Partial<WorkItemBrief> = {}) =>
  boardItem(n, 'done', { closed_at: closed, ...overrides })
const custom = (from: string, to: string): ClosedPeriod => ({ period: 'custom', from, to })
const preset = (period: 'today' | 'week' | 'weeks4'): ClosedPeriod => ({ period, from: '', to: '' })
const kept = (items: readonly WorkItemBrief[], closed: ClosedPeriod, now = NOW) =>
  references(items.filter((item) => matchesWorkFilter(item, { text: '', closed }, undefined, now)))

afterEach(() => {
  vi.restoreAllMocks()
})

describe('«Closed in a period»', () => {
  it('takes the days of the reader’s own whole, the first one from its midnight', () => {
    const space = [
      done(1, at(11, 23, 59, 59)),
      done(2, at(12, 0)),
      done(3, at(18, 23, 59, 59)),
      done(4, at(19, 0)),
      // Open work is no closed work, whatever moment it carries.
      boardItem(5, 'dev', { closed_at: at(15) }),
    ]
    expect(kept(space, custom('2026-11-12', '2026-11-18'))).toEqual(['MAIN-2', 'MAIN-3'])
    // The wrong way round, a period keeps nothing.
    expect(kept(space, custom('2026-11-18', '2026-11-12'))).toEqual([])
  })

  it('reads the presets to the end of today: today, this week from Monday, the past four weeks', () => {
    const space = [
      done(1, at(19, 23, 30)),
      done(2, at(16, 0)),
      done(3, at(15, 23, 59, 59)),
      done(4, at(1, 12)),
      done(5, '2026-10-20T12:00:00Z'),
    ]
    expect(kept(space, preset('today'))).toEqual(['MAIN-1'])
    expect(kept(space, preset('week'))).toEqual(['MAIN-1', 'MAIN-2'])
    expect(kept(space, preset('weeks4'))).toEqual(['MAIN-1', 'MAIN-2', 'MAIN-3', 'MAIN-4'])
  })

  it('counts a card by when it closed, not by when it was last written', () => {
    // Filed straight into its finished state, it closed when it was filed; an edit after the
    // period moves its last write, not its close.
    const space = [done(1, at(14), { updated_at: at(25) }), done(2, at(25), { updated_at: at(14) })]
    expect(kept(space, custom('2026-11-12', '2026-11-18'))).toEqual(['MAIN-1'])
  })

  it('keeps exactly the cards the Volumes read counts as Done and as Cancelled for the period', () => {
    // One store's answers: the board of a space and its Volumes read, asked for the days
    // 2026-11-12 to 2026-11-18 at UTC+03:00, where the reader here stands.
    vi.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(-180)
    const fixture = readServerFixture('closed-in-period.json') as Record<string, unknown>
    const board = validateReadModel(fixture.board)
    const volumes = validateVolumesAnswer(fixture.volumes)
    const closed = custom('2026-11-12', '2026-11-18')
    const counted = (category: 'completed' | 'cancelled') => {
      const row = volumes.counts.categories.find((each) => each.category === category)
      return (row?.tasks ?? 0) + (row?.goals ?? 0) + (row?.stages ?? 0)
    }
    const shown = (category: 'completed' | 'cancelled') =>
      references(
        board.work_items.filter((item) =>
          matchesWorkFilter(item, { text: '', category: [category], closed }),
        ),
      ).toSorted()
    // Done: the first moment of the period, its last second, the goal, and the task filed
    // finished, which closed when it was filed though its last write falls after the period;
    // Cancelled: the one inside, not the one at the first moment after it.
    expect(shown('completed')).toEqual(['ALPHA-1', 'ALPHA-3', 'ALPHA-6', 'ALPHA-7'])
    expect(shown('completed')).toHaveLength(counted('completed'))
    expect(shown('cancelled')).toEqual(['ALPHA-5'])
    expect(shown('cancelled')).toHaveLength(counted('cancelled'))
  })
})

describe('its address', () => {
  const manifest = OFFLINE_MODULE_FALLBACK.find((module) => module.module_id === 'planning')

  it('is `period`, with `from` and `to` for days of the reader’s own, beside `cat`', () => {
    const done: WorkFilter = {
      text: '',
      category: ['completed'],
      closed: custom('2026-11-12', '2026-11-18'),
    }
    const state = filterRouteState(done)
    expect(state).toEqual({
      cat: 'completed',
      period: 'custom',
      from: '2026-11-12',
      to: '2026-11-18',
    })
    expect(readWorkFilter(state)).toEqual(done)
    expect(filterRouteState({ text: '', category: ['cancelled'], closed: preset('week') })).toEqual(
      {
        cat: 'cancelled',
        period: 'week',
      },
    )
    assert.ok(manifest)
    expect(() => validateManifestRouteState(manifest, state)).not.toThrow()
    // Writing a filter without it takes its keys out, and keeps the rest.
    expect(writeWorkFilter({ ...state, view: 'list' }, { text: '' }, 2048).state).toEqual({
      view: 'list',
    })
  })

  it('reads a period it does not know, or half of one’s days, as no condition', () => {
    expect(readWorkFilter({ period: 'year' }).closed).toBeUndefined()
    expect(readWorkFilter({ period: 'custom', from: '2026-11-12' }).closed).toBeUndefined()
    expect(readWorkFilter({ period: 'today', from: '2026-11-12' }).closed).toEqual(preset('today'))
    expect(readsEveryFilterValue({ period: 'year' })).toBe(false)
    expect(readsEveryFilterValue({ period: 'week' })).toBe(true)
  })
})

describe('its words and its menu', () => {
  it('names each period on its chip, in either language', () => {
    const { global } = i18n()
    const chip = (closed: ClosedPeriod) => tokenName({ facet: 'closed', closed }, global.t)
    expect(chip(preset('week'))).toBe('Closed this week')
    expect(chip(custom('2026-11-12', '2026-11-18'))).toBe('Closed on my days')
    global.locale.value = 'ru'
    expect(chip(preset('week'))).toBe('Закрыто на этой неделе')
    expect(chip(preset('weeks4'))).toBe('Закрыто за 4 недели')
  })

  it('stands among the conditions, its row stepping into the periods, one chosen at a time', () => {
    const { t } = i18n().global
    const groups = filterGroups({
      categories: [],
      filter: { text: '' },
      held: null,
      items: [],
      t,
      now: NOW,
    })
    const top = stepGroups(groups, 'facets', '', t)
    expect(top[0].options.at(-1)).toMatchObject({
      text: 'Closed in a period',
      action: { do: 'open', facet: 'closed' },
    })
    expect(top[1].options.map((option) => option.text)).not.toContain('Closed in a period')
    const periods = stepGroups(groups, 'closed', '', t)[0]
    expect(periods.options.map((option) => option.text)).toEqual([
      'Today',
      'This week',
      'Past 4 weeks',
      'Days of my own',
    ])
    // Days of the reader's own first stand at the week up to today.
    const own = periods.options[3].action
    expect(own).toMatchObject({ token: { closed: custom('2026-11-13', '2026-11-19') } })
    // A second period takes the first one's place, and the same one again takes it out.
    let filter: WorkFilter = { text: '' }
    filter = toggleToken(filter, { facet: 'closed', closed: preset('week') })
    filter = toggleToken(filter, { facet: 'closed', closed: preset('today') })
    expect(filter.closed).toEqual(preset('today'))
    expect(toggleToken(filter, { facet: 'closed', closed: preset('today') }).closed).toBeUndefined()
  })
})
