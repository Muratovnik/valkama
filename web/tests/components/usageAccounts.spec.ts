/**
 * Under which organization an item's work ran, on its Agents tab: a strip in time order with a
 * numbered mark at each change, each organization with its share, and the changes in words.
 *
 * The strip is drawn for the eye, so these cases read what is said without a hue: every
 * organization is named in the list, and the start and the numbered changes name each stretch
 * in the order the strip draws them. Every id and figure is made up.
 */
import { createI18n } from 'vue-i18n'

import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'

import UsageAccounts from '@/widgets/work-item-inspector/components/UsageAccounts.vue'

import type { ItemUsage } from '@/shared/api/planningUsageApi.ts'
import { messages, pluralRules } from '@/shared/i18n/index.ts'

import { NO_TOKENS, noUsage } from '../fixtures/usage.ts'
import { hintOf } from '../support/hint.ts'

const ORG_A = '3fa1b2c4-0000-4000-8000-00000000000a'
const ORG_B = '9c0d77e1-0000-4000-8000-00000000000b'

type Stretch = ItemUsage['account_stretches'][number]

const known = (id: string) => ({ id, unknown: false })
const UNKNOWN = { id: null, unknown: true }

function stretch(account: Stretch['account'], at: string, seconds: number): Stretch {
  return {
    account,
    started_at: at,
    ended_at: at,
    seconds,
    tokens: { ...NO_TOKENS, input: 1000 },
    estimated_api_cost_usd: 1,
    unpriced_tokens: 0,
  }
}

/** An item's read whose accounts are what its stretches add up to, ranked by time. */
function usageOf(stretches: Stretch[]): ItemUsage {
  const totals = new Map<string, { account: Stretch['account']; seconds: number }>()
  for (const one of stretches) {
    const key = one.account.id ?? ''
    const held = totals.get(key) ?? { account: one.account, seconds: 0 }
    totals.set(key, { ...held, seconds: held.seconds + one.seconds })
  }
  const whole = stretches.reduce((sum, one) => sum + one.seconds, 0)
  return noUsage({
    agent_seconds: whole,
    account_stretches: stretches,
    accounts: [...totals.values()]
      .sort((left, right) => right.seconds - left.seconds)
      .map(({ account, seconds }) => ({
        account,
        share: Math.round((seconds / whole) * 10_000) / 10_000,
        seconds,
        tokens: { ...NO_TOKENS, input: 1000 },
        estimated_api_cost_usd: 1,
        unpriced_tokens: 0,
      })),
  })
}

function mountAccounts(usage: ItemUsage) {
  const i18n = createI18n({
    legacy: false,
    locale: 'en',
    messages,
    pluralRules,
    datetimeFormats: {
      en: {
        day: {
          month: 'short',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
          timeZone: 'UTC',
        },
      },
    },
  })
  return mount(UsageAccounts, {
    attachTo: document.body,
    global: { plugins: [i18n] },
    props: { usage, estimated: false },
  })
}

const words = (text: string) => text.replaceAll(/\s+/gu, ' ').trim()
/**
 * A row as it is read: its parts are grid and flex items, which a browser reads apart, so they
 * are joined with a space here as well.
 */
const read = (row: { element: Element }) =>
  words([...row.element.children].map((part) => part.textContent).join(' '))
const listed = (wrapper: ReturnType<typeof mountAccounts>) =>
  wrapper.findAll('.account-row').map((row) => read(row))
const changes = (wrapper: ReturnType<typeof mountAccounts>) =>
  wrapper.findAll('.account-change').map((row) => read(row))

describe('the organizations an item ran under', () => {
  afterEach(() => document.body.replaceChildren())

  it('with one: a whole strip, its share, and no change to mark', () => {
    const wrapper = mountAccounts(usageOf([stretch(known(ORG_A), '2030-03-04T09:00:00Z', 3600)]))
    const parts = wrapper.findAll('.account-part')
    expect(parts).toHaveLength(1)
    expect(parts[0].attributes('style')).toContain('inline-size: 100%')
    expect(wrapper.findAll('.account-mark')).toHaveLength(0)
    expect(wrapper.find('.account-changes').exists()).toBe(false)
    expect(listed(wrapper)).toEqual([expect.stringMatching(/^3fa1b2c4 100% of the time /u)])
  })

  it('with two: each part with its share, and each change numbered where it happened', () => {
    const wrapper = mountAccounts(
      usageOf([
        stretch(known(ORG_A), '2030-03-04T09:00:00Z', 1800),
        stretch(known(ORG_B), '2030-03-04T14:32:00Z', 1200),
        stretch(known(ORG_A), '2030-03-05T08:10:00Z', 600),
      ]),
    )
    const parts = wrapper.findAll('.account-part')
    expect(parts.map((part) => part.attributes('style'))).toEqual([
      'inset-inline-start: 0%; inline-size: 50%;',
      'inset-inline-start: 50%; inline-size: 33.33333333333333%;',
      'inset-inline-start: 83.33333333333333%; inline-size: 16.666666666666664%;',
    ])
    // The same account keeps its hue wherever it stands; the other one has its own.
    const slots = parts.map((part) => part.attributes('data-slot'))
    expect(slots[0]).toBe(slots[2])
    expect(slots[0]).not.toBe(slots[1])
    expect(wrapper.findAll('.account-mark').map((mark) => mark.attributes('style'))).toEqual([
      'inset-inline-start: 50%;',
      'inset-inline-start: 83.33333333333333%;',
    ])
    expect(wrapper.findAll('.chart-tick').map((tick) => words(tick.text()))).toEqual(['1', '2'])
    expect(listed(wrapper)).toEqual([
      expect.stringMatching(/^3fa1b2c4 67% of the time /u),
      expect.stringMatching(/^9c0d77e1 33% of the time /u),
    ])
    // Read without the hue: the start and each change name the stretches in the strip's order.
    expect(changes(wrapper)).toEqual([
      'From the start 3fa1b2c4',
      '1 Mar 04, 14:32 9c0d77e1',
      '2 Mar 05, 08:10 3fa1b2c4',
    ])
    // The id is printed by its start and given whole in its hint.
    expect(wrapper.findAll('.account-name').map((name) => hintOf(name))).toEqual([ORG_A, ORG_B])
  })

  it('an organization nobody recorded is named as unknown and hatched, not given a hue', () => {
    const wrapper = mountAccounts(
      usageOf([
        stretch(UNKNOWN, '2030-03-04T09:00:00Z', 900),
        stretch(known(ORG_A), '2030-03-04T10:00:00Z', 2700),
      ]),
    )
    const parts = wrapper.findAll('.account-part')
    expect(parts[0].attributes('data-slot')).toBe('other')
    expect(parts[0].classes()).toContain('is-unknown')
    expect(parts[1].attributes('data-slot')).toBe('1')
    expect(parts[1].classes()).not.toContain('is-unknown')
    expect(listed(wrapper)).toEqual([
      expect.stringMatching(/^3fa1b2c4 75% of the time /u),
      expect.stringMatching(/^Unknown organization 25% of the time /u),
    ])
    expect(changes(wrapper)).toEqual([
      'From the start Unknown organization',
      '1 Mar 04, 10:00 3fa1b2c4',
    ])
  })
})
