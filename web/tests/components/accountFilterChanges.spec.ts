import { defineComponent, h } from 'vue'

/**
 * How the page says a change against the period before once it is narrowed to an account, whose
 * organization placed work on no account then. The oracle is DESIGN's rule for the section's
 * table, which holds for the overview and the rail as well: a figure of the accounts the page is
 * narrowed to that spent in the period, whose organizations' work no reading placed on an account
 * came to more in the period before than their own figure there, has «not known before» as its
 * change and no percent. A filter by organization, or none, keeps the percent. Each expectation is
 * worked out by hand from the stretches below.
 */
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import SpendingTable from '@/pages/analytics/components/SpendingTable.vue'
import SpendingTiles from '@/pages/analytics/components/SpendingTiles.vue'
import TokenKindsPanel from '@/pages/analytics/components/TokenKindsPanel.vue'
import { useCrossRead } from '@/pages/analytics/composables/useCrossRead.ts'
import type { CrossRead } from '@/pages/analytics/composables/useCrossRead.ts'
import { overviewFigures } from '@/pages/analytics/utils/railFigures.ts'
import { comparedLines } from '@/pages/analytics/utils/usageFigures.ts'

import type { Measure } from '@/shared/api/analyticsAddress.ts'

import { seatValue, serveUsage, value } from '../fixtures/analytics.ts'
import type { TimedStretch } from '../fixtures/analytics.ts'
import { analyticsI18n, stubAnalyticsReads } from '../support/analyticsReads.ts'

const ORG = '6a6a6a6a-1111-4222-8333-444444444444'
const OTHER_ORG = '8c8c8c8c-1111-4222-8333-444444444444'
const P = seatValue(`${ORG}/7b7b7b7b-1111-4222-8333-444444444444`)
const LOOSE = seatValue(`${ORG}/`)
const OTHER_LOOSE = seatValue(`${OTHER_ORG}/`)
const HOUR = 3600
const MODEL_A = value('model-a')
const MODEL_B = value('model-b')

const at = (day: number) => new Date(Date.UTC(2026, 10, day, 10))
const of = (seat: typeof P, model: typeof MODEL_A, organization = ORG) => ({
  seat,
  model,
  account: value(organization),
})

/**
 * P now: three hours on model-a, one on model-b. P before: an hour on model-a, a million tokens
 * and $10. Its organization's work on no account before: two hours on model-a and half an hour on
 * model-b, with ten times P's own tokens and cost an hour; another organization's, ten hours.
 */
const OWN: TimedStretch[] = [
  { at: at(9), group: of(P, MODEL_A), spend: { seconds: 3 * HOUR, tokens: 1.5e6, cost: 15 } },
  { at: at(10), group: of(P, MODEL_B), spend: { seconds: HOUR, tokens: 0.5e6, cost: 5 } },
  { at: at(7), group: of(P, MODEL_A), spend: { seconds: HOUR, tokens: 1e6, cost: 10 } },
  {
    at: at(7),
    group: of(OTHER_LOOSE, MODEL_A, OTHER_ORG),
    spend: { seconds: 10 * HOUR, tokens: 1e7, cost: 100 },
  },
]
const UNPLACED: TimedStretch[] = [
  ...OWN,
  { at: at(7), group: of(LOOSE, MODEL_A), spend: { seconds: 2 * HOUR, tokens: 2e6, cost: 20 } },
  { at: at(8), group: of(LOOSE, MODEL_B), spend: { seconds: HOUR / 2, tokens: 0.5e6, cost: 5 } },
]
/** The control: half an hour of the organization's work on no account, under P's own hour. */
const PLACED: TimedStretch[] = [
  ...OWN,
  {
    at: at(7),
    group: of(LOOSE, MODEL_A),
    spend: { seconds: HOUR / 2, tokens: 0.5e6, cost: 5 },
  },
]

/** Three days by `by`, beside the three before, read with `filters` as the page asks. */
function read(world: readonly TimedStretch[], by: string, filters: Record<string, string>) {
  const query = new URLSearchParams({
    from: '2026-11-09',
    to: '2026-11-12',
    step: 'day',
    utc_offset: '0',
    group_by: by,
    compare: 'true',
    ...filters,
  })
  return serveUsage(world, query).usage
}

const ACCOUNT = { seat: P.id ?? '' }
const ORGANIZATION = { account: ORG }

const words = (text: string) => text.replaceAll(/\s+/gu, ' ').trim()

/** Each tile's change, by its measure, as it reads. */
function tileChanges(world: readonly TimedStretch[], filters: Record<string, string>) {
  const tiles = mount(SpendingTiles, {
    props: { usage: read(world, 'model', filters), readAt: at(11), measure: 'time' as Measure },
    global: { plugins: [analyticsI18n('en')] },
  })
  const changes = tiles.findAll('[data-direction]')
  expect(changes).toHaveLength(3)
  const measures = tiles.findAll('[data-measure]').map((one) => one.attributes('data-measure'))
  return Object.fromEntries(changes.map((one, index) => [measures[index], words(one.text())]))
}

/**
 * Each row of the table by model, and its totals, as they read: name, before and change; with
 * `find`, the rows a search keeps and the total of those found above the period's.
 */
function tableChanges(
  world: readonly TimedStretch[],
  filters: Record<string, string>,
  find?: string,
) {
  const table = mount(SpendingTable, {
    props: {
      across: null,
      cross: { status: 'off' } as const,
      by: 'model',
      filters: {},
      measure: 'time',
      usage: read(world, 'model', filters),
      ...(find ? { find } : {}),
    },
    global: { plugins: [analyticsI18n('en')] },
  })
  return table
    .findAll('tbody tr, tfoot tr')
    .map((row) => row.findAll('th, td').map((cell) => words(cell.text())))
    .map((row) => [row[0], row[4], row[5]])
}

/** The counted kinds' changes in the panel of the tokens by kind. */
function kindChanges(world: readonly TimedStretch[], filters: Record<string, string>) {
  const panel = mount(TokenKindsPanel, {
    props: { usage: read(world, 'work_item', filters) },
    global: { plugins: [analyticsI18n('en')] },
  })
  return panel
    .findAll('.kinds-table tbody tr')
    .map((row) => row.findAll('th, td').map((cell) => cell.text()))
    .filter((row) => row.length === 4)
    .map((row) => [row[0], row[3]])
}

/** What the probe renders: nothing, it only holds the read. */
const blank = () => h('span')

/**
 * The split section's own reads of the answer on show, narrowed to P, by model and task: its
 * pairs' changes, each by its model and task.
 */
async function pairChanges(world: readonly TimedStretch[]) {
  stubAnalyticsReads((query) => serveUsage(world, query))
  const shown = read(world, 'model', ACCOUNT)
  const held: { cross?: { state: { value: CrossRead } } } = {}
  mount(
    defineComponent({
      setup() {
        held.cross = useCrossRead({
          across: () => 'work_item',
          filters: () => ({ seat: [ACCOUNT.seat] }),
          usage: () => shown,
        })
        return blank
      },
    }),
  )
  await flushPromises()
  const crossed = held.cross?.state.value
  if (crossed?.status !== 'ready') throw new Error('the split read is not ready')
  const { usage } = crossed
  return comparedLines({
    rows: usage.rows,
    before: usage.comparison?.rows ?? null,
    unplaced: usage.comparison?.unplaced?.rows ?? null,
    dimension: 'model',
    across: 'work_item',
    measure: 'time',
    name: (one) => one.id ?? '',
  }).map((line) => line.change?.direction)
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('a change narrowed to an account whose organization placed work on no account before', () => {
  it('is «not known before» in each of the overview’s tiles', () => {
    // Two and a half hours on no account against P's one, ten times its tokens and cost an hour.
    expect(tileChanges(UNPLACED, ACCOUNT)).toEqual({
      time: 'Account not known before',
      tokens: 'Account not known before',
      cost: 'Account not known before',
    })
  })

  it('keeps the percent where its own figure outweighed that work, or the page is not narrowed to an account', () => {
    const percents = tileChanges(PLACED, ACCOUNT)
    expect(percents.time).toMatch(/^↑ 300% against /u)
    expect(percents.tokens).toMatch(/^↑ 100% against /u)
    expect(percents.cost).toMatch(/^↑ 100% against /u)
    // By its organization the unplaced work is its own: four hours against three and a half.
    expect(tileChanges(UNPLACED, ORGANIZATION).time).toMatch(/^↑ 14% against /u)
    // Unfiltered, the other organization's ten hours are there too: four against thirteen and a half.
    expect(tileChanges(UNPLACED, {}).time).toMatch(/^↓ 70% against /u)
  })

  it('is «not known before» on the rail’s overview, which the change of its total says', () => {
    expect(overviewFigures(read(UNPLACED, 'model', ACCOUNT), 'time', at(11)).change).toEqual({
      direction: 'unplaced',
    })
    expect(overviewFigures(read(PLACED, 'model', ACCOUNT), 'time', at(11)).change).toEqual({
      direction: 'up',
      ratio: 3,
    })
  })

  it('holds each line of the table and its total to the same line of the work left out', () => {
    expect(tableChanges(UNPLACED, ACCOUNT)).toEqual([
      // Two unplaced hours on model-a against P's one.
      ['model-a', '1 h', 'Account not known before'],
      // Half an hour unplaced on model-b against nothing of P's own.
      ['model-b', '0 min', 'Account not known before'],
      ['Total', '1 h', 'Account not known before'],
    ])
    expect(tableChanges(PLACED, ACCOUNT)).toEqual([
      ['model-a', '1 h', '↑ 200%'],
      ['model-b', '0 min', 'Nothing before'],
      ['Total', '1 h', '↑ 300%'],
    ])
  })

  it('holds the total of the rows a search keeps to the work left out on those rows', () => {
    expect(tableChanges(UNPLACED, ACCOUNT, 'model-a')).toEqual([
      ['model-a', '1 h', 'Account not known before'],
      ['Total of those found', '1 h', 'Account not known before'],
      ['Total for the period', '1 h', 'Account not known before'],
    ])
    expect(tableChanges(PLACED, ACCOUNT, 'model-a')).toEqual([
      ['model-a', '1 h', '↑ 200%'],
      ['Total of those found', '1 h', '↑ 200%'],
      ['Total for the period', '1 h', '↑ 300%'],
    ])
  })

  it('holds each kind of the tokens to the same kind of the work left out', () => {
    expect(kindChanges(UNPLACED, ACCOUNT)).toEqual([
      ['Input', 'Account not known before'],
      ['Output', 'Account not known before'],
      ['Cache write, 5 min', 'Account not known before'],
      ['Cache read', 'Account not known before'],
      ['Reasoning', 'Account not known before'],
    ])
    expect(kindChanges(PLACED, ACCOUNT)).toEqual([
      ['Input', '↑ 100%'],
      ['Output', '↑ 100%'],
      ['Cache write, 5 min', '↑ 100%'],
      ['Cache read', '↑ 100%'],
      ['Reasoning', '↑ 100%'],
    ])
  })

  it('holds each pair of a split section to the same pair of the work left out', async () => {
    // No stretch above names a task, so each pair is a model and the task nobody can place.
    expect(await pairChanges(UNPLACED)).toEqual(['unplaced', 'unplaced'])
    expect(await pairChanges(PLACED)).toEqual(['up', 'none'])
  })
})
