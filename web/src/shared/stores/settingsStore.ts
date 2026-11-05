import { defineStore } from 'pinia'
import { watch } from 'vue'

import { useStorage } from '@vueuse/core'

import { applyKindColors } from '@/shared/lib/kindColors.ts'
import { DEFAULT_SETTINGS, mergeSettings } from '@/shared/lib/settings'
import type { PlatformSettings } from '@/shared/lib/settings'

/**
 * Owner settings, shared by every screen that reads or writes them.
 *
 * Two useStorage instances on one key do not observe each other inside a single
 * window, so the settings page, the session-opening flow and a card must hold the same ref.
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
  // At once and on the document, so a mark drawn next already has it, whichever window chose.
  // The shell asks for this store as it sets up, before it draws anything, so the first
  // glyph on a page has the owner's colour; a browser spec watches for that first glyph.
  watch(
    () => settings.value.kindColors,
    (colors) => applyKindColors(colors),
    {
      flush: 'sync',
      immediate: true,
    },
  )
  return { settings }
})
