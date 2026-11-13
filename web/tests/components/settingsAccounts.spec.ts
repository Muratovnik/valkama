/**
 * The owner names the accounts work was billed to in Settings: a row per account the past year
 * saw, with its id and its share of the year's agent time, a field that names it and a way to
 * clear the name; an account already named that the year did not see keeps its row. The name is
 * kept in Valkama and is what the Analytics page says (`spendingWords.spec.ts`); here, that the
 * screen reads and writes it there, and that saving, a failed save and a cleared name each say so.
 */
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import SettingsAccounts from '@/pages/settings/components/SettingsAccounts.vue'

import VButton from '@/shared/ui/VButton.vue'
import VTextInput from '@/shared/ui/VTextInput.vue'

import { serveUsage, value } from '../fixtures/analytics.ts'
import { stubAccountNames } from '../support/accountNames.ts'
import { analyticsI18n, stubAnalyticsReads } from '../support/analyticsReads.ts'

const MAIN = 'f0f0f0f0-1111-4222-8333-444455556666'
const SIDE = '9c0de5b1-1111-4222-8333-444455556666'
const OLD = '00aa11bb-1111-4222-8333-444455556666'
const TODAY = new Date(2026, 10, 12, 15, 0)

/** Nineteen hours on the main account and one on the other, this week. */
const STRETCHES = [
  { at: new Date(2026, 10, 10, 9), group: { account: value(MAIN) }, spend: { seconds: 19 * 3600 } },
  { at: new Date(2026, 10, 11, 9), group: { account: value(SIDE) }, spend: { seconds: 3600 } },
]

async function mountAccounts(locale: 'en' | 'ru' = 'en') {
  const wrapper = mount(SettingsAccounts, {
    attachTo: document.body,
    global: { plugins: [analyticsI18n(locale)] },
  })
  await flushPromises()
  return wrapper
}

type Wrapper = Awaited<ReturnType<typeof mountAccounts>>

const rowsOf = (wrapper: Wrapper) => wrapper.findAll('.settings-row').map((row) => row.text())

const field = (wrapper: Wrapper, id: string) => {
  const found = wrapper
    .findAllComponents(VTextInput)
    .find((input) => input.props('label') === `Name of account ${id}`)
  if (!found) throw new Error(`no field for ${id}`)
  return found.find('input')
}

const valueOf = (wrapper: Wrapper, id: string) =>
  (field(wrapper, id).element as HTMLInputElement).value

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

  /** The usage read and Valkama's names, each answering as the test says. */
  function serve(answer: (query: URLSearchParams) => unknown, stored: Record<string, string> = {}) {
    reads = stubAnalyticsReads(answer)
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

  it('reads the past year by account and lists each with its id and its share of the time', async () => {
    const wrapper = await mountAccounts()
    // A year of days up to and with today, on the local calendar.
    const query = reads.grouped('account')[0]
    expect(query?.get('from')).toBe('2025-11-12')
    expect(query?.get('to')).toBe('2026-11-13')
    const rows = rowsOf(wrapper)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toContain(MAIN)
    expect(rows[0]).toContain('95% of agent time in the past year')
    expect(rows[1]).toContain(SIDE)
    expect(rows[1]).toContain('5% of agent time')
    // Unnamed, the field says what Analytics shows for it instead: the start of its id.
    expect(field(wrapper, MAIN).attributes('placeholder')).toBe('No name: Analytics shows f0f0f0f0')
    expect(clearOf(wrapper, MAIN).attributes('disabled')).toBeDefined()
    expect(statusOf(wrapper).exists()).toBe(false)
  })

  it('shows the names Valkama keeps', async () => {
    serve((query) => serveUsage(STRETCHES, query), { [MAIN]: 'Main' })
    const wrapper = await mountAccounts()
    expect(valueOf(wrapper, MAIN)).toBe('Main')
    expect(valueOf(wrapper, SIDE)).toBe('')
    expect(clearOf(wrapper, MAIN).attributes('disabled')).toBeUndefined()
  })

  it('saves a name to Valkama once the field is left, keeping a space while it is typed', async () => {
    const wrapper = await mountAccounts()
    const input = field(wrapper, MAIN)
    await input.setValue('Main ')
    expect(valueOf(wrapper, MAIN)).toBe('Main ')
    expect(names.writes).toEqual([])
    await input.setValue('Main  account')
    await input.trigger('focusout')
    await flushPromises()
    expect(names.writes).toEqual([{ names: { [MAIN]: 'Main account' }, replace: true }])
    expect(names.stored).toEqual({ [MAIN]: 'Main account' })
    expect(valueOf(wrapper, MAIN)).toBe('Main account')
    expect(statusOf(wrapper).text()).toBe('Saved the name of account f0f0f0f0.')
    expect(clearOf(wrapper, MAIN).attributes('disabled')).toBeUndefined()
    // Left again unchanged, nothing more is written.
    await input.trigger('focusout')
    await flushPromises()
    expect(names.writes).toHaveLength(1)
  })

  it('saves on Enter too, and says it is saving while the write is out', async () => {
    const wrapper = await mountAccounts()
    names.hold()
    const input = field(wrapper, SIDE)
    await input.setValue('Night shift')
    await input.trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(statusOf(wrapper).text()).toBe('Saving the name of account 9c0de5b1…')
    expect(valueOf(wrapper, SIDE)).toBe('Night shift')
    names.release()
    await flushPromises()
    expect(names.stored).toEqual({ [SIDE]: 'Night shift' })
    expect(statusOf(wrapper).text()).toBe('Saved the name of account 9c0de5b1.')
  })

  it('says why a save failed, keeps what was typed, and saves it on request', async () => {
    const wrapper = await mountAccounts()
    names.refuse({ status: 400, message: 'the name is too long' })
    const input = field(wrapper, MAIN)
    await input.setValue('Main')
    await input.trigger('focusout')
    await flushPromises()
    expect(statusOf(wrapper).text()).toBe(
      'Could not save the name of account f0f0f0f0: the name is too long',
    )
    expect(valueOf(wrapper, MAIN)).toBe('Main')
    expect(names.stored).toEqual({})
    await retryOf(wrapper).trigger('click')
    await flushPromises()
    expect(names.stored).toEqual({ [MAIN]: 'Main' })
    expect(statusOf(wrapper).text()).toBe('Saved the name of account f0f0f0f0.')
  })

  it('clears a name, says so, leaves the others and keeps the field in focus', async () => {
    serve((query) => serveUsage(STRETCHES, query), { [MAIN]: 'Main', [SIDE]: 'Side' })
    const wrapper = await mountAccounts()
    await clearOf(wrapper, MAIN).trigger('click')
    await flushPromises()
    expect(names.writes).toEqual([{ names: { [MAIN]: '' }, replace: true }])
    expect(names.stored).toEqual({ [SIDE]: 'Side' })
    expect(valueOf(wrapper, MAIN)).toBe('')
    expect(document.activeElement).toBe(field(wrapper, MAIN).element)
    expect(statusOf(wrapper).text()).toBe('Cleared the name of account f0f0f0f0.')
    expect(clearOf(wrapper, MAIN).attributes('disabled')).toBeDefined()
  })

  it('keeps a row for an account named before that the year did not see', async () => {
    serve((query) => serveUsage(STRETCHES, query), { [OLD]: 'Former' })
    const wrapper = await mountAccounts('ru')
    const rows = rowsOf(wrapper)
    expect(rows).toHaveLength(3)
    expect(rows[2]).toContain(OLD)
    expect(rows[2]).toContain('За год работы не было')
    const fields = wrapper
      .findAll('input')
      .map((input) => (input.element as HTMLInputElement).value)
    expect(fields).toEqual(['', '', 'Former'])
  })

  it('says when the accounts could not be read and reads them again on request', async () => {
    serve(() => ({ status: 503 }))
    const wrapper = await mountAccounts()
    expect(statusOf(wrapper).text()).toBe('Could not read the accounts work was billed to.')
    serve((query) => serveUsage(STRETCHES, query))
    await retryOf(wrapper).trigger('click')
    await flushPromises()
    expect(rowsOf(wrapper)).toHaveLength(2)
    expect(statusOf(wrapper).exists()).toBe(false)
  })

  it('lists no field until Valkama’s names are read, and reads them again on request', async () => {
    names.refuse({ status: 503 })
    const wrapper = await mountAccounts()
    expect(statusOf(wrapper).text()).toBe('Could not read the names Valkama keeps for accounts.')
    expect(rowsOf(wrapper)).toEqual([])
    await retryOf(wrapper).trigger('click')
    await flushPromises()
    expect(rowsOf(wrapper)).toHaveLength(2)
    expect(statusOf(wrapper).exists()).toBe(false)
  })
})
