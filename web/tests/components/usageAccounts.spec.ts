/**
 * Under which organization an item's work ran, on its Agents tab: a strip in time order with a
 * numbered mark at each change, each organization with its share, and the changes in words. A
 * change is work under a known organization after work under a different known one; a stretch
 * whose organization nobody recorded is drawn and listed but is neither a change nor hides one.
 *
 * The strip is drawn for the eye, so these cases read what is said without a hue: every
 * organization is named in the list, and the start and the numbered changes name each known
 * organization the work changed to, in the strip's order. Every id and figure is made up.
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

/**
 * Where each element stands along the strip and how long it is, in percent of the strip, read
 * from the two properties that place it: a number each, whatever else the style holds.
 */
const placed = (found: readonly { element: Element }[], property: string) =>
  found.map((one) =>
    Number.parseFloat((one.element as HTMLElement).style.getPropertyValue(property)),
  )
/** As many values as expected, each within a millionth of a percent of its own. */
function expectClose(actual: readonly number[], expected: readonly number[]) {
  expect(actual).toHaveLength(expected.length)
  for (const [index, value] of expected.entries()) expect(actual[index]).toBeCloseTo(value, 6)
}

describe('the organizations an item ran under', () => {
  afterEach(() => document.body.replaceChildren())

  it('with one: a whole strip, its share, and no change to mark', () => {
    const wrapper = mountAccounts(usageOf([stretch(known(ORG_A), '2030-03-04T09:00:00Z', 3600)]))
    const parts = wrapper.findAll('.account-part')
    expect(parts).toHaveLength(1)
    expectClose(placed(parts, 'inline-size'), [100])
    expect(wrapper.findAll('.account-mark')).toHaveLength(0)
    expect(changes(wrapper)).toEqual([])
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
    // Half an hour, twenty minutes and ten of fifty minutes, each from where the last ended.
    expectClose(placed(parts, 'inset-inline-start'), [0, 50, (50 / 60) * 100])
    expectClose(placed(parts, 'inline-size'), [50, (20 / 60) * 100, (10 / 60) * 100])
    // The same account keeps its hue wherever it stands; the other one has its own.
    const slots = parts.map((part) => part.attributes('data-slot'))
    expect(slots[0]).toBe(slots[2])
    expect(slots[0]).not.toBe(slots[1])
    expectClose(placed(wrapper.findAll('.account-mark'), 'inset-inline-start'), [
      50,
      (50 / 60) * 100,
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

  it('an organization nobody recorded is named as unknown in the plain neutral, not given a hue', () => {
    const wrapper = mountAccounts(
      usageOf([
        stretch(UNKNOWN, '2030-03-04T09:00:00Z', 900),
        stretch(known(ORG_A), '2030-03-04T10:00:00Z', 2700),
      ]),
    )
    const parts = wrapper.findAll('.account-part')
    expect(parts[0].attributes('data-slot')).toBe('apart')
    expect(parts[1].attributes('data-slot')).toBe('1')
    // Never hatched: a hatch says a figure not final yet, and this one is final.
    expect(wrapper.findAll('.hatched')).toHaveLength(0)
    expect(listed(wrapper)).toEqual([
      expect.stringMatching(/^3fa1b2c4 75% of the time /u),
      expect.stringMatching(/^Unknown organization 25% of the time /u),
    ])
    // Work under one known organization after work nobody recorded the organization of is not
    // a change: nothing says the organization was another.
    expect(wrapper.findAll('.account-mark')).toHaveLength(0)
    expect(wrapper.findAll('.chart-tick')).toHaveLength(0)
    expect(changes(wrapper)).toEqual([])
  })

  it('one organization around work nobody recorded the organization of has no change', () => {
    const wrapper = mountAccounts(
      usageOf([
        stretch(known(ORG_A), '2030-03-04T09:00:00Z', 600),
        stretch(UNKNOWN, '2030-03-04T09:10:00Z', 600),
        stretch(known(ORG_A), '2030-03-04T09:20:00Z', 600),
        stretch(UNKNOWN, '2030-03-04T09:30:00Z', 600),
        stretch(known(ORG_A), '2030-03-04T09:40:00Z', 600),
      ]),
    )
    // Every stretch is still drawn, the unknown ones in the neutral, and both are listed.
    const parts = wrapper.findAll('.account-part')
    expect(parts.map((part) => part.attributes('data-slot'))).toEqual([
      '1',
      'apart',
      '1',
      'apart',
      '1',
    ])
    expect(listed(wrapper)).toEqual([
      expect.stringMatching(/^3fa1b2c4 60% of the time /u),
      expect.stringMatching(/^Unknown organization 40% of the time /u),
    ])
    expect(wrapper.findAll('.account-mark')).toHaveLength(0)
    expect(wrapper.findAll('.chart-tick')).toHaveLength(0)
    expect(changes(wrapper)).toEqual([])
  })

  it('two organizations with work nobody recorded between them change once, where the second starts', () => {
    const wrapper = mountAccounts(
      usageOf([
        stretch(known(ORG_A), '2030-03-04T09:00:00Z', 1800),
        stretch(UNKNOWN, '2030-03-04T09:30:00Z', 600),
        stretch(known(ORG_B), '2030-03-04T11:45:00Z', 1200),
      ]),
    )
    expect(wrapper.findAll('.account-part')).toHaveLength(3)
    // The second starts after half an hour and ten minutes, of an hour in all.
    expectClose(placed(wrapper.findAll('.account-mark'), 'inset-inline-start'), [(40 / 60) * 100])
    expect(wrapper.findAll('.chart-tick').map((tick) => words(tick.text()))).toEqual(['1'])
    expect(changes(wrapper)).toEqual(['From the start 3fa1b2c4', '1 Mar 04, 11:45 9c0d77e1'])
  })
})
