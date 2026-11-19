/**
 * The accounts' table beside the period before, where an organization placed work on no account
 * then. The oracle is DESIGN's rule for the section's table: an account that spent in the period,
 * whose organization's work no reading placed on an account («account not known») came to more in
 * the period before than its own figure there, has «not known before» as its change and no
 * percent; every other value keeps the percent by the tiles' rule. Each row is written out by hand.
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import SpendingTable from '@/pages/analytics/components/SpendingTable.vue'

import { seatValue, usageAnswer, value } from '../fixtures/analytics.ts'
import type { Stretch } from '../fixtures/analytics.ts'
import { analyticsI18n } from '../support/analyticsReads.ts'

/** A table of a section that is not split. */
const UNCROSSED = { across: null, cross: { status: 'off' } as const }

const words = (text: string) => text.replaceAll(/\s+/gu, ' ').trim()

/** Each row of a table as it reads: its name, its time before and its change. */
const changes = (wrapper: ReturnType<typeof mount>) =>
  wrapper
    .findAll('tbody tr')
    .map((row) => row.findAll('th, td').map((cell) => words(cell.text())))
    .map((row) => [row[0], row[4], row[5]])

/**
 * Accounts of one organization and of another. This period: P four hours, R of the other
 * organization two, Q one. The period before: P ten minutes, Q four hours, S five minutes and the
 * organization's work no reading placed on an account three hours; R an hour, its organization's
 * work all placed.
 */
const ORG = '0a0a0a0a-1111-4222-8333-444444444444'
const OTHER_ORG = '4e4e4e4e-1111-4222-8333-444444444444'
const P = seatValue(`${ORG}/1b1b1b1b-1111-4222-8333-444444444444`)
const Q = seatValue(`${ORG}/2c2c2c2c-1111-4222-8333-444444444444`)
const S = seatValue(`${ORG}/3d3d3d3d-1111-4222-8333-444444444444`)
const R = seatValue(`${OTHER_ORG}/5f5f5f5f-1111-4222-8333-444444444444`)
const LOOSE = seatValue(`${ORG}/`)
const HOUR = 3600
const SEATS_NOW: Stretch[] = [
  { day: 0, group: { seat: P }, spend: { seconds: 4 * HOUR } },
  { day: 0, group: { seat: R }, spend: { seconds: 2 * HOUR } },
  { day: 1, group: { seat: Q }, spend: { seconds: HOUR } },
]
const SEATS_BEFORE: Stretch[] = [
  { day: 0, group: { seat: P }, spend: { seconds: 600 } },
  { day: 0, group: { seat: Q }, spend: { seconds: 4 * HOUR } },
  { day: 0, group: { seat: S }, spend: { seconds: 300 } },
  { day: 1, group: { seat: LOOSE }, spend: { seconds: 3 * HOUR } },
  { day: 1, group: { seat: R }, spend: { seconds: HOUR } },
]

function seatTable(locale: 'en' | 'ru' = 'en', by: 'seat' | 'account' = 'seat') {
  const usage = usageAnswer({
    first: new Date(2026, 10, 9),
    days: 3,
    groupBy: [by],
    stretches: by === 'seat' ? SEATS_NOW : SEATS_NOW.map((one) => byOrganization(one)),
    before: by === 'seat' ? SEATS_BEFORE : SEATS_BEFORE.map((one) => byOrganization(one)),
  }).usage
  return mount(SpendingTable, {
    props: { ...UNCROSSED, by, filters: {}, measure: 'time', usage },
    global: { plugins: [analyticsI18n(locale)] },
  })
}

/** A stretch of an account as its organization's (`account`). */
function byOrganization(stretch: Stretch): Stretch {
  return { ...stretch, group: { account: value(stretch.group.seat?.organization ?? '') } }
}

describe('the accounts beside the period before', () => {
  it('say «not known before» for an account whose organization’s unplaced work outweighed it then', () => {
    expect(changes(seatTable())).toEqual([
      // Three hours of its organization's work were placed on no account, against its ten
      // minutes: a percent would read the placing as growth.
      ['1b1b1b1b', '10 min', 'Account not known before'],
      // The other organization placed all its work: the percent stands as it always has.
      ['5f5f5f5f', '1 h', '↑ 100%'],
      // Its own four hours outweigh the three unplaced: the percent stands too.
      ['2c2c2c2c', '4 h', '↓ 75%'],
      ['0a0a0a0a · account not known', '3 h', '↓ 100%'],
      // Nothing now is a fall by its whole figure, whatever placed the work before.
      ['3d3d3d3d', '5 min', '↓ 100%'],
    ])
    expect(changes(seatTable('ru'))[0]).toEqual(['1b1b1b1b', '10 мин', 'Раньше не определён'])
  })

  it('leave a percent to every value of another dimension, an organization included', () => {
    expect(changes(seatTable('en', 'account'))).toEqual([
      ['0a0a0a0a', '7 h 15 min', '↓ 31%'],
      ['4e4e4e4e', '1 h', '↑ 100%'],
    ])
  })
})
