import { defineStore } from 'pinia'
import { ref } from 'vue'

import { useStorage } from '@vueuse/core'

import {
  browserOpenerCapabilities,
  DEFAULT_SETTINGS,
  mergeSettings,
  normalizeOpenerCapabilities,
  reconcileOpener,
} from '@/shared/lib/settings'
import type { OpenerCapability, OpenerClient, PlatformSettings } from '@/shared/lib/settings'

const OPENER_CLIENTS: readonly OpenerClient[] = ['claude', 'codex', 'other']

/**
 * Owner settings, shared by every screen that reads or writes them.
 *
 * Two useStorage instances on one key do not observe each other inside a single
 * window, so the settings panel and the notification wiring must hold the same
 * ref. A store is what guarantees that; the hand-rolled module-level singleton
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
  settings.value = mergeSettings(settings.value)
  const openerCatalog = ref<OpenerCapability[]>(browserOpenerCapabilities())
  const openerCatalogLoading = ref(false)
  const openerCatalogFallback = ref(false)

  /**
   * The browser catalog is authoritative only when no desktop bridge exists.
   * Malformed or failed desktop discovery may supply a bounded display fallback,
   * but it never reconciles persisted selections.
   */
  async function loadOpenerCatalog() {
    const bridge = window.valkamaDesktop
    let authoritative = bridge === undefined
    if (bridge && typeof bridge.listSessionOpeners === 'function') {
      openerCatalogLoading.value = true
      openerCatalogFallback.value = false
      try {
        openerCatalog.value = normalizeOpenerCapabilities(await bridge.listSessionOpeners())
        authoritative = true
      } catch {
        openerCatalog.value = browserOpenerCapabilities()
        openerCatalogFallback.value = true
      } finally {
        openerCatalogLoading.value = false
      }
    } else if (bridge) {
      openerCatalog.value = browserOpenerCapabilities()
      openerCatalogFallback.value = true
    }
    if (!authoritative) return
    for (const client of OPENER_CLIENTS) {
      settings.value.openers[client] = reconcileOpener(
        client,
        settings.value.openers[client],
        openerCatalog.value,
      )
    }
  }

  return {
    loadOpenerCatalog,
    openerCatalog,
    openerCatalogFallback,
    openerCatalogLoading,
    settings,
  }
})
