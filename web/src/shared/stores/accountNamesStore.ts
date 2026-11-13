import { defineStore } from 'pinia'
import { ref, shallowRef } from 'vue'

import { fetchAccountNames, saveAccountNames } from '@/shared/api/quotaApi.ts'
import type { AccountAliases } from '@/shared/lib/accountAliases.ts'
import { useSettingsStore } from '@/shared/stores/settingsStore.ts'

export type AccountNamesState = 'failed' | 'loading' | 'ready'

/**
 * The owner's names for accounts, as Valkama keeps them, shared by Settings, which writes them,
 * and the Analytics page, which says them.
 *
 * The first read on a device moves the names a build before this one kept in the device's
 * settings: they are written with `replace` false, so a name the store already has stays, and
 * they leave the device only once the store has taken them. A move that fails leaves them for the
 * next read, which reads what the store has meanwhile. Reads and writes go one after another, so
 * an older answer never lands after a newer one, and a read again after one succeeded keeps the
 * names it had while it waits and if it fails.
 */
export const useAccountNamesStore = defineStore('accountNames', () => {
  const settingsStore = useSettingsStore()
  const names = shallowRef<AccountAliases>({})
  const state = ref<AccountNamesState>('loading')
  /** Whether a read has succeeded: until then no name is known, not even the lack of one. */
  const known = ref(false)
  let queue: Promise<unknown> = Promise.resolve()
  let reading: Promise<void> | null = null

  function inTurn<T>(task: () => Promise<T>): Promise<T> {
    const run = queue.then(task)
    queue = run.catch(() => null)
    return run
  }

  /** What the store answered to this device's own names, or null where there were none to move. */
  async function moveKept(): Promise<AccountAliases | null> {
    const kept = settingsStore.settings.accountAliases
    if (Object.keys(kept).length === 0) return null
    try {
      const stored = await saveAccountNames(kept, false)
      settingsStore.settings.accountAliases = {}
      return stored
    } catch {
      return null
    }
  }

  async function readNow() {
    try {
      names.value = (await moveKept()) ?? (await fetchAccountNames())
      known.value = true
      state.value = 'ready'
    } catch {
      state.value = 'failed'
    }
  }

  /** Read the names again; a read already under way answers for this one. */
  function read(): Promise<void> {
    reading ??= inTurn(readNow).finally(() => {
      reading = null
    })
    return reading
  }

  /** Name an account, or with an empty name take its name away; throws where the write failed. */
  async function save(id: string, name: string) {
    names.value = await inTurn(() => saveAccountNames({ [id]: name }))
    known.value = true
    state.value = 'ready'
  }

  return { names, state, known, read, save }
})
