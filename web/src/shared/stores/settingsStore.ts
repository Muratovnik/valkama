import { defineStore } from 'pinia'

import { useStorage } from '@vueuse/core'

import { DEFAULT_SETTINGS, mergeSettings } from '@/shared/lib/settings'
import type { PlatformSettings } from '@/shared/lib/settings'

/**
 * Owner settings, shared by every screen that reads or writes them.
 *
 * Two useStorage instances on one key do not observe each other inside a single
 * window, so the settings page and session-opening flow must hold the same ref.
 * A store is what guarantees that; the hand-rolled module-level singleton
 * this replaces guaranteed it only for as long as nobody imported it twice.
 */
export const useSettingsStore = defineStore('settings', () => {
  const settings = useStorage<PlatformSettings>(
    'valkama-settings',
    DEFAULT_SETTINGS,
    localStorage,
    {
      mergeDefaults: (value) => mergeSettings(value),
    },
  )
  // Written back at once, so what a build before this one stored is read once.
  settings.value = mergeSettings(settings.value)
  return { settings }
})
