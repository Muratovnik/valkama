/**
 * The owner names the accounts work was billed to in Settings: a row per account the past year
 * saw, with its id and its share of the year's agent time, a field that names it and a way to
 * clear the name; an account already named that the year did not see keeps its row. The name is
 * what the Analytics page says (`spendingWords.spec.ts`); here, that the screen writes it.
 */
import { createPinia, setActivePinia } from 'pinia'

import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import SettingsAccounts from '@/pages/settings/components/SettingsAccounts.vue'

import { useSettingsStore } from '@/shared/stores/settingsStore.ts'
import VButton from '@/shared/ui/VButton.vue'
import VTextInput from '@/shared/ui/VTextInput.vue'

import { serveUsage, value } from '../fixtures/analytics.ts'
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

const rowsOf = (wrapper: Awaited<ReturnType<typeof mountAccounts>>) =>
  wrapper.findAll('.settings-row').map((row) => row.text())

const field = (wrapper: Awaited<ReturnType<typeof mountAccounts>>, id: string) => {
  const found = wrapper
    .findAllComponents(VTextInput)
    .find((input) => input.props('label') === `Name of account ${id}`)
  if (!found) throw new Error(`no field for ${id}`)
  return found
}

const clearOf = (wrapper: Awaited<ReturnType<typeof mountAccounts>>, id: string) => {
  const found = wrapper
    .findAllComponents(VButton)
    .find((button) => button.attributes('aria-label') === `Clear the name of account ${id}`)
  if (!found) throw new Error(`no clear for ${id}`)
  return found
}

describe('the accounts in Settings', () => {
  let reads: ReturnType<typeof stubAnalyticsReads>

  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    vi.useFakeTimers({ toFake: ['Date'], now: TODAY })
    reads = stubAnalyticsReads((query) => serveUsage(STRETCHES, query))
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
    expect(field(wrapper, MAIN).props('placeholder')).toBe('No name: Analytics shows f0f0f0f0')
    expect(clearOf(wrapper, MAIN).attributes('disabled')).toBeDefined()
  })

  it('names an account as it is typed, keeping a space while it is typed', async () => {
    const wrapper = await mountAccounts()
    const input = field(wrapper, MAIN).find('input')
    await input.setValue('Main ')
    expect(useSettingsStore().settings.accountAliases).toEqual({ [MAIN]: 'Main' })
    expect((input.element as HTMLInputElement).value).toBe('Main ')
    await input.setValue('Main  account')
    await input.trigger('focusout')
    expect(useSettingsStore().settings.accountAliases).toEqual({ [MAIN]: 'Main account' })
    expect((input.element as HTMLInputElement).value).toBe('Main account')
    expect(clearOf(wrapper, MAIN).attributes('disabled')).toBeUndefined()
  })

  it('clears a name, leaves the others and keeps the field in focus', async () => {
    useSettingsStore().settings.accountAliases = { [MAIN]: 'Main', [SIDE]: 'Side' }
    const wrapper = await mountAccounts()
    await clearOf(wrapper, MAIN).trigger('click')
    expect(useSettingsStore().settings.accountAliases).toEqual({ [SIDE]: 'Side' })
    const input = field(wrapper, MAIN).find('input')
    expect((input.element as HTMLInputElement).value).toBe('')
    expect(document.activeElement).toBe(input.element)
  })

  it('keeps a row for an account named before that the year did not see', async () => {
    useSettingsStore().settings.accountAliases = { [OLD]: 'Former' }
    const wrapper = await mountAccounts('ru')
    const rows = rowsOf(wrapper)
    expect(rows).toHaveLength(3)
    expect(rows[2]).toContain(OLD)
    expect(rows[2]).toContain('За год работы не было')
  })

  it('says when the accounts could not be read and reads them again on request', async () => {
    reads = stubAnalyticsReads(() => ({ status: 503 }))
    const wrapper = await mountAccounts()
    expect(wrapper.find('[role="status"]').text()).toBe(
      'Could not read the accounts work was billed to.',
    )
    reads = stubAnalyticsReads((query) => serveUsage(STRETCHES, query))
    const retry = wrapper.findAllComponents(VButton).find((button) => button.text() === 'Retry')
    await retry?.trigger('click')
    await flushPromises()
    expect(rowsOf(wrapper)).toHaveLength(2)
    expect(wrapper.find('[role="status"]').exists()).toBe(false)
  })
})
