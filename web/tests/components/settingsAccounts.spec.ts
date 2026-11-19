/**
 * The owner names the organizations work was billed to and their accounts in Settings: a row per
 * organization the past year's work or the quota saw, with its id and its share of the year's
 * agent time, and under it a row per account of it, the most time first — its UUID, or when its
 * week resets for one known by its weekly reset alone, and that two accounts may run under it —
 * each with a field that names it, a placeholder that says what Analytics shows without one, and a
 * way to clear the name. A key already named that neither saw keeps its row. The name is kept in
 * Valkama and is what the Analytics page says (`spendingWords.spec.ts`); here, that the screen
 * reads and writes it there by the account's id or the organization's, and that saving, a failed
 * save and a cleared name each say so.
 */
import { flushPromises, mount } from '@vue/test-utils'
import type { DOMWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import SettingsAccounts from '@/pages/settings/components/SettingsAccounts.vue'

import type { QuotaAccount } from '@/shared/api/analyticsApi.ts'
import VButton from '@/shared/ui/VButton.vue'
import VTextInput from '@/shared/ui/VTextInput.vue'

import { seatValue, serveUsage } from '../fixtures/analytics.ts'
import { quotaAnswer, quotaAt } from '../fixtures/quota.ts'
import { stubAccountNames } from '../support/accountNames.ts'
import { analyticsI18n, stubAnalyticsReads } from '../support/analyticsReads.ts'

const MAIN = 'f0f0f0f0-1111-4222-8333-444455556666'
const SIDE = '9c0de5b1-1111-4222-8333-444455556666'
const OLD = '00aa11bb-1111-4222-8333-444455556666'
/** Two accounts of the main organization, one the quota alone read, and the side's weekly one. */
const A = `${MAIN}/a1a1a1a1-2222-4333-8444-555566667777`
const B = `${MAIN}/b2b2b2b2-2222-4333-8444-555566667777`
const C = `${MAIN}/c3c3c3c3-2222-4333-8444-555566667777`
const WEEKLY = `${SIDE}/weekly:4T09:00Z`
const TODAY = new Date(2026, 10, 12, 15, 0)

/**
 * Twenty hours of this week: fifteen on A, whose week resets on Monday at 09:00 UTC, three on B,
 * one of the main organization's on no known account, and one on the side's weekly account, under
 * which two accounts may run.
 */
const STRETCHES = [
  {
    at: new Date(2026, 10, 10, 9),
    group: { seat: seatValue(A, { weeklyReset: '1T09:00Z' }) },
    spend: { seconds: 15 * 3600 },
  },
  { at: new Date(2026, 10, 10, 9), group: { seat: seatValue(B) }, spend: { seconds: 3 * 3600 } },
  {
    at: new Date(2026, 10, 11, 9),
    group: { seat: seatValue(`${MAIN}/`) },
    spend: { seconds: 3600 },
  },
  {
    at: new Date(2026, 10, 11, 9),
    group: { seat: seatValue(WEEKLY, { shared: true }) },
    spend: { seconds: 3600 },
  },
]

/** An account of the main organization as the quota's answer names it, with no window read. */
const entry = (id: string): QuotaAccount => ({
  account: id,
  organization: MAIN,
  account_uuid: id.slice(MAIN.length + 1),
  weekly_reset: '2T15:00Z',
  shared: false,
  plan: null,
  name: null,
  organization_name: null,
  no_source: false,
  windows: [],
})

/** The quota's answer: B, whose work the year saw, and C, which it read and the year did not. */
const quota = () => quotaAnswer({ ...quotaAt(TODAY), accounts: [entry(B), entry(C)] })

const placeholder = (input: DOMWrapper<Element>) => input.attributes('placeholder')

/** When a week resets on the ISO weekday `isoDay` at `hours` UTC, in the reader's own time. */
function resetAt(isoDay: number, hours: number) {
  // 1 January 2024 was a Monday, so 1–7 January are the ISO weekdays in order.
  const reset = new Date(Date.UTC(2024, 0, isoDay, hours))
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][reset.getDay()]
  const time = [reset.getHours(), reset.getMinutes()]
    .map((part) => String(part).padStart(2, '0'))
    .join(':')
  return `${day} ${time}`
}

/** When the side's account's week resets, Thursday 09:00 UTC: «Thu 12:00» at +03:00. */
const SIDE_RESET = resetAt(4, 9)
/** When A's week resets, Monday 09:00 UTC, and B's, as the quota reads it, Tuesday 15:00 UTC. */
const A_RESET = resetAt(1, 9)
const B_RESET = resetAt(2, 15)

async function mountAccounts(locale: 'en' | 'ru' = 'en') {
  const wrapper = mount(SettingsAccounts, {
    attachTo: document.body,
    global: { plugins: [analyticsI18n(locale)] },
  })
  await flushPromises()
  return wrapper
}

type Wrapper = Awaited<ReturnType<typeof mountAccounts>>

const rowsOf = (wrapper: Wrapper) =>
  wrapper.findAll('[data-account-row]').map((row) => ({
    kind: row.attributes('data-account-row'),
    text: row.text(),
  }))

const field = (wrapper: Wrapper, label: string) => {
  const found = wrapper
    .findAllComponents(VTextInput)
    .find((input) => input.props('label') === label)
  if (!found) throw new Error(`no field ${label}`)
  return found.find('input')
}
const accountField = (wrapper: Wrapper, id: string) => field(wrapper, `Name of account ${id}`)
const organizationField = (wrapper: Wrapper, id: string) =>
  field(wrapper, `Name of organization ${id}`)

const valueOf = (input: ReturnType<typeof field>) => (input.element as HTMLInputElement).value

const clearOf = (wrapper: Wrapper, id: string) => {
  const found = wrapper
    .findAllComponents(VButton)
    .find((button) => button.attributes('aria-label') === `Clear the name of account ${id}`)
  if (!found) throw new Error(`no clear for ${id}`)
  return found
}

const statusOf = (wrapper: Wrapper) => wrapper.find('[role="status"]')

const retryOf = (wrapper: Wrapper) => {
  const found = wrapper.findAllComponents(VButton).find((button) => button.text() === 'Retry')
  if (!found) throw new Error('no retry')
  return found
}

describe('the accounts in Settings', () => {
  let reads: ReturnType<typeof stubAnalyticsReads>
  let names: ReturnType<typeof stubAccountNames>

  /** The usage and quota reads and Valkama's names, each answering as the test says. */
  function serve(
    answer: (query: URLSearchParams) => unknown,
    stored: Record<string, string> = {},
    quotaRead: () => unknown = quota,
  ) {
    reads = stubAnalyticsReads(answer, quotaRead)
    names = stubAccountNames(stored)
  }

  beforeEach(() => {
    localStorage.clear()
    vi.useFakeTimers({ toFake: ['Date'], now: TODAY })
    serve((query) => serveUsage(STRETCHES, query))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    document.body.innerHTML = ''
  })

  it('reads the past year by account and the quota, and lists each organization with its accounts under it', async () => {
    const wrapper = await mountAccounts()
    // A year of days up to and with today, on the local calendar, and the quota at the same offset.
    const query = reads.grouped('seat')[0]
    expect(query?.get('from')).toBe('2025-11-12')
    expect(query?.get('to')).toBe('2026-11-13')
    expect(reads.quotaAsked.map((asked) => asked.get('utc_offset'))).toEqual([
      String(-TODAY.getTimezoneOffset()),
    ])
    const rows = rowsOf(wrapper)
    expect(rows.map((row) => row.kind)).toEqual([
      'organization',
      'account',
      'account',
      'account',
      'organization',
      'account',
    ])
    // The organization counts its work on no known account; its accounts the most time first,
    // then the one only the quota read.
    const said = [
      [MAIN, '95% of agent time in the past year'],
      [A.slice(MAIN.length + 1), '75% of agent time'],
      [B.slice(MAIN.length + 1), '15% of agent time'],
      [C.slice(MAIN.length + 1), 'No work in the past year'],
      [SIDE, '5% of agent time'],
      [
        `Resets ${SIDE_RESET}`,
        '5% of agent time in the past year · May be two accounts under one weekly reset',
      ],
    ]
    for (const [index, words] of said.entries())
      for (const part of words) expect(rows[index]?.text).toContain(part)
    // Unnamed, a field says what Analytics shows for it instead.
    expect(placeholder(organizationField(wrapper, MAIN))).toBe('No name: Analytics shows f0f0f0f0')
    expect(placeholder(accountField(wrapper, A))).toBe(
      `No name: Analytics shows a1a1a1a1 · resets ${A_RESET}`,
    )
    expect(placeholder(accountField(wrapper, WEEKLY))).toBe(
      `No name: Analytics shows 9c0de5b1 · resets ${SIDE_RESET}`,
    )
    expect(clearOf(wrapper, A).attributes('disabled')).toBeDefined()
    expect(statusOf(wrapper).exists()).toBe(false)
  })

  it('shows the names Valkama keeps, and an account’s placeholder the name it would take', async () => {
    const DESK = `${MAIN}/weekly:1T09:00Z`
    serve((query) => serveUsage(STRETCHES, query), { [MAIN]: 'Main', [DESK]: 'Desk' })
    const wrapper = await mountAccounts()
    expect(valueOf(organizationField(wrapper, MAIN))).toBe('Main')
    expect(valueOf(accountField(wrapper, A))).toBe('')
    // A takes the name its weekly reset was given; B its organization's and the start of its UUID.
    expect(accountField(wrapper, A).attributes('placeholder')).toBe('No name: Analytics shows Desk')
    expect(accountField(wrapper, B).attributes('placeholder')).toBe(
      `No name: Analytics shows Main · b2b2b2b2 · resets ${B_RESET}`,
    )
    // The weekly reset's name has its row under the organization, which the year did not see.
    expect(valueOf(accountField(wrapper, DESK))).toBe('Desk')
    expect(rowsOf(wrapper).map((row) => row.kind)).toEqual([
      'organization',
      'account',
      'account',
      'account',
      'account',
      'organization',
      'account',
    ])
  })

  it('saves an account’s name by its id once the field is left, keeping a space while it is typed', async () => {
    const wrapper = await mountAccounts()
    const input = accountField(wrapper, A)
    await input.setValue('Main ')
    expect(valueOf(accountField(wrapper, A))).toBe('Main ')
    expect(names.writes).toEqual([])
    await input.setValue('Main  account')
    await input.trigger('focusout')
    await flushPromises()
    expect(names.writes).toEqual([{ names: { [A]: 'Main account' }, replace: true }])
    expect(names.stored).toEqual({ [A]: 'Main account' })
    expect(valueOf(accountField(wrapper, A))).toBe('Main account')
    expect(statusOf(wrapper).text()).toBe(`Saved the name of account a1a1a1a1 · resets ${A_RESET}.`)
    expect(clearOf(wrapper, A).attributes('disabled')).toBeUndefined()
    // Left again unchanged, nothing more is written.
    await input.trigger('focusout')
    await flushPromises()
    expect(names.writes).toHaveLength(1)
  })

  it('saves an organization’s name on Enter by its id, and says it is saving while the write is out', async () => {
    const wrapper = await mountAccounts()
    names.hold()
    const input = organizationField(wrapper, SIDE)
    await input.setValue('Night shift')
    await input.trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(statusOf(wrapper).text()).toBe('Saving the name of organization 9c0de5b1…')
    expect(valueOf(organizationField(wrapper, SIDE))).toBe('Night shift')
    names.release()
    await flushPromises()
    expect(names.stored).toEqual({ [SIDE]: 'Night shift' })
    expect(statusOf(wrapper).text()).toBe('Saved the name of organization 9c0de5b1.')
  })

  it('says why a save failed, keeps what was typed, and saves it on request', async () => {
    const wrapper = await mountAccounts()
    names.refuse({ status: 400, message: 'the name is too long' })
    const input = accountField(wrapper, WEEKLY)
    await input.setValue('Desk')
    await input.trigger('focusout')
    await flushPromises()
    expect(statusOf(wrapper).text()).toBe(
      `Could not save the name of account 9c0de5b1 · resets ${SIDE_RESET}: the name is too long`,
    )
    expect(valueOf(accountField(wrapper, WEEKLY))).toBe('Desk')
    expect(names.stored).toEqual({})
    await retryOf(wrapper).trigger('click')
    await flushPromises()
    expect(names.stored).toEqual({ [WEEKLY]: 'Desk' })
    expect(statusOf(wrapper).text()).toBe(
      `Saved the name of account 9c0de5b1 · resets ${SIDE_RESET}.`,
    )
  })

  it('clears a name, says so, leaves the others and keeps the field in focus', async () => {
    serve((query) => serveUsage(STRETCHES, query), { [A]: 'Main', [SIDE]: 'Side' })
    const wrapper = await mountAccounts()
    await clearOf(wrapper, A).trigger('click')
    await flushPromises()
    expect(names.writes).toEqual([{ names: { [A]: '' }, replace: true }])
    expect(names.stored).toEqual({ [SIDE]: 'Side' })
    expect(valueOf(accountField(wrapper, A))).toBe('')
    expect(document.activeElement).toBe(accountField(wrapper, A).element)
    expect(statusOf(wrapper).text()).toBe(
      `Cleared the name of account a1a1a1a1 · resets ${A_RESET}.`,
    )
    expect(clearOf(wrapper, A).attributes('disabled')).toBeDefined()
  })

  it('keeps a row for an organization and an account named before that the year did not see', async () => {
    const FORMER = `${OLD}/d4d4d4d4-2222-4333-8444-555566667777`
    serve((query) => serveUsage(STRETCHES, query), { [OLD]: 'Former', [FORMER]: 'Desk' })
    const wrapper = await mountAccounts('ru')
    const rows = rowsOf(wrapper)
    expect(rows).toHaveLength(8)
    expect(rows.slice(6).map((row) => row.kind)).toEqual(['organization', 'account'])
    expect(rows[6]?.text).toContain(OLD)
    expect(rows[6]?.text).toContain('За год работы не было')
    expect(rows[7]?.text).toContain('d4d4d4d4-2222-4333-8444-555566667777')
    const fields = wrapper
      .findAll('input')
      .map((input) => (input.element as HTMLInputElement).value)
    expect(fields).toEqual(['', '', '', '', '', '', 'Former', 'Desk'])
  })

  it('says when the accounts could not be read, by either read, and reads both again on request', async () => {
    serve(() => ({ status: 503 }))
    const failed = await mountAccounts()
    expect(statusOf(failed).text()).toBe('Could not load the accounts work was billed to.')
    serve((query) => serveUsage(STRETCHES, query))
    await retryOf(failed).trigger('click')
    await flushPromises()
    expect(rowsOf(failed)).toHaveLength(6)
    expect(statusOf(failed).exists()).toBe(false)
    failed.unmount()

    serve(
      (query) => serveUsage(STRETCHES, query),
      {},
      () => ({ status: 503 }),
    )
    const unread = await mountAccounts()
    expect(statusOf(unread).text()).toBe('Could not load the accounts work was billed to.')
    expect(rowsOf(unread)).toEqual([])
  })

  it('lists no field until Valkama’s names are read, and reads them again on request', async () => {
    names.refuse({ status: 503 })
    const wrapper = await mountAccounts()
    expect(statusOf(wrapper).text()).toBe('Could not load the account names kept in Valkama.')
    expect(rowsOf(wrapper)).toEqual([])
    await retryOf(wrapper).trigger('click')
    await flushPromises()
    expect(rowsOf(wrapper)).toHaveLength(6)
    expect(statusOf(wrapper).exists()).toBe(false)
  })
})
