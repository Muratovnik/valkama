/**
 * The sessions and the weekly quota in the head of an item's Agents tab. The oracle is the
 * connection contract («How much work an item took»): `sessions` counts every session that spent
 * on the work or wrote to it, which can be more than the card lists; `quota` gives one line per
 * account and week, the latest first, whose percent is the item's share of that week times the
 * week's spent percent, assumed in proportion to the API price and leaning high, never added up
 * across weeks; and the part of the cost on no account that can be shown.
 */
import { flushPromises } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'

import { richUsage } from '../fixtures/usage.ts'
import { mountSummary } from './usageSummaryHost.ts'

afterEach(() => {
  document.body.innerHTML = ''
})

const week = (seat: string, ends: string, share: number | null, used: number | null) => ({
  account: { organization: 'org-alpha-0000', account_uuid: 'acct-beta-11111111' },
  seat,
  week_ends_at: ends,
  share,
  week_used_percent: used,
  percent: share === null || used === null ? null : Math.round(share * used * 100) / 100,
})

const usage = richUsage({
  sessions: 3,
  quota: {
    weeks: [
      week('org-alpha-0000/acct-beta-11111111', '2030-03-11T09:00:00Z', 0.25, 40),
      week('org-alpha-0000/acct-beta-11111111', '2030-03-04T09:00:00Z', 0.5, null),
      week('org-alpha-0000/acct-beta-11111111', '2030-02-25T09:00:00Z', null, 10),
    ],
    unknown_share: 0.1,
  },
})

const weeks = () =>
  [...document.querySelectorAll<HTMLElement>('[data-week]')].map((line) => {
    const percent = line.querySelector<HTMLElement>('[data-part="percent"]')
    return [percent?.textContent.trim(), percent?.getAttribute('aria-description')]
  })

describe('the sessions and the quota of an item’s work', () => {
  it('counts the sessions, saying they can be more than the card lists', async () => {
    mountSummary(usage)
    await flushPromises()
    const figure = [...document.querySelectorAll('.work-usage-figure')].find((one) =>
      one.textContent.startsWith('Sessions'),
    )
    // The figure, then its why, which a finger reaches by a press.
    expect(figure?.textContent.replaceAll(/\s+/gu, ' ').trim()).toBe(
      'Sessions 3' +
        'Every session that spent on the work or wrote to it, each once. Sessions that only ' +
        'spent on it count too, so this can be more than the sessions the card lists.',
    )
  })

  it('gives each account’s week its percent and why, the latest first, with no total', async () => {
    mountSummary(usage)
    await flushPromises()
    expect(weeks()).toEqual([
      [
        '≈\u{A0}10% of the week',
        'Its share of the account’s cost that week, 25%, times the 40% of the week spent.',
      ],
      ['—', 'No reading of this week says how much of it is spent.'],
      ['—', 'The account’s work that week had no cost.'],
    ])
    const text = document.body.textContent
    expect(text).toContain('Assumes a quota is spent in proportion to the API price')
    expect(document.querySelector('[data-part="unknown"]')?.textContent.trim()).toBe(
      '≈\u{A0}10% of its cost is on no account that can be shown.',
    )
  })

  it('says it in Russian', async () => {
    mountSummary(usage, { locale: 'ru' })
    await flushPromises()
    expect(weeks()[0]?.[0]).toBe('≈\u{A0}10\u{A0}% недели')
  })

  it('draws no quota for work on no week', async () => {
    mountSummary(richUsage({ sessions: 1 }))
    await flushPromises()
    expect(document.querySelectorAll('[data-week]')).toHaveLength(0)
    expect(document.body.textContent).not.toContain('Weekly quota')
  })
})
