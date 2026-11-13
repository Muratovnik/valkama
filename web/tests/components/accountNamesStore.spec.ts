/**
 * The names Valkama keeps for accounts, as the page holds them, and the one move of the names a
 * device kept before: the owner's decision is that every name lives in Valkama, that what a device
 * already holds is written there once without overwriting a name Valkama has, and that it then
 * leaves the device.
 */
import { createPinia, setActivePinia } from 'pinia'

import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useAccountNamesStore } from '@/shared/stores/accountNamesStore.ts'
import { useSettingsStore } from '@/shared/stores/settingsStore.ts'

import { stubAccountNames } from '../support/accountNames.ts'

const MAIN = 'f0f0f0f0-1111-4222-8333-444455556666'
const SIDE = '9c0de5b1-2222-4333-8444-555566667777'

/** What a build before this one left in the device's settings. */
function keptOnDevice(names: Record<string, string>) {
  localStorage.setItem('valkama-settings', JSON.stringify({ accountAliases: names }))
}

const deviceNames = () =>
  (JSON.parse(localStorage.getItem('valkama-settings') ?? '{}') as { accountAliases?: unknown })
    .accountAliases

describe('the names Valkama keeps for accounts', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async () => new Response('{}', { status: 404 })),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('moves the names a device kept to Valkama once, and they leave the device', async () => {
    keptOnDevice({ [MAIN]: 'Main', [SIDE]: 'Side' })
    const server = stubAccountNames()
    setActivePinia(createPinia())
    const names = useAccountNamesStore()
    await names.read()
    expect(server.writes).toEqual([{ names: { [MAIN]: 'Main', [SIDE]: 'Side' }, replace: false }])
    expect(server.stored).toEqual({ [MAIN]: 'Main', [SIDE]: 'Side' })
    expect(names.names).toEqual({ [MAIN]: 'Main', [SIDE]: 'Side' })
    await flushPromises()
    expect(useSettingsStore().settings.accountAliases).toEqual({})
    expect(deviceNames()).toEqual({})

    // The next read, and the next page load, read Valkama and move nothing again.
    await names.read()
    setActivePinia(createPinia())
    await useAccountNamesStore().read()
    expect(server.writes).toHaveLength(1)
    expect(server.reads()).toBe(2)
    expect(useAccountNamesStore().names).toEqual({ [MAIN]: 'Main', [SIDE]: 'Side' })
  })

  it('never overwrites a name Valkama already has with one the device kept', async () => {
    keptOnDevice({ [MAIN]: 'Kept on this device', [SIDE]: 'Side' })
    const server = stubAccountNames({ [MAIN]: 'Given since' })
    setActivePinia(createPinia())
    const names = useAccountNamesStore()
    await names.read()
    expect(server.stored).toEqual({ [MAIN]: 'Given since', [SIDE]: 'Side' })
    expect(names.names).toEqual({ [MAIN]: 'Given since', [SIDE]: 'Side' })
    await flushPromises()
    expect(deviceNames()).toEqual({})
  })

  it('keeps the device’s names for the next read when the move fails', async () => {
    keptOnDevice({ [SIDE]: 'Side' })
    const server = stubAccountNames({ [MAIN]: 'Main' })
    server.refuse({ status: 503 })
    setActivePinia(createPinia())
    const names = useAccountNamesStore()
    await names.read()
    // What Valkama has is read all the same.
    expect(names.state).toBe('ready')
    expect(names.names).toEqual({ [MAIN]: 'Main' })
    await flushPromises()
    expect(deviceNames()).toEqual({ [SIDE]: 'Side' })

    await names.read()
    expect(names.names).toEqual({ [MAIN]: 'Main', [SIDE]: 'Side' })
    await flushPromises()
    expect(deviceNames()).toEqual({})
  })

  it('keeps the names it had while a read again fails, and says so', async () => {
    const server = stubAccountNames({ [MAIN]: 'Main' })
    setActivePinia(createPinia())
    const names = useAccountNamesStore()
    await names.read()
    server.refuse({ status: 503 })
    await names.read()
    expect(names.state).toBe('failed')
    expect(names.known).toBe(true)
    expect(names.names).toEqual({ [MAIN]: 'Main' })
  })
})
