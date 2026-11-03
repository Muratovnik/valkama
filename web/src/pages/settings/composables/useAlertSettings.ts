import { computed, onMounted, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import {
  alertRefusalDetail,
  fetchAlertSettings,
  saveAlertSettings,
} from '@/shared/api/alertsApi.ts'
import type { AlertSettings } from '@/shared/api/alertsApi.ts'
import { uiError, uiLoading, uiReady } from '@/shared/api/platformUiState.ts'
import type { PlatformUiState } from '@/shared/api/platformUiState.ts'
import { failureMessage, typedFailure } from '@/shared/api/typedFailure.ts'

/** The row a write came from, so that its failure stands beside what was changed. */
export type AlertSettingsRow = 'enabled' | 'events' | 'content' | 'locale'

const PANEL_PAYLOAD = true as const

/** The server's words for a refusal, otherwise the product's for the failure. */
export function useAlertFailureText() {
  const { t } = useI18n()
  return (error: unknown): string => {
    const detail = alertRefusalDetail(error)
    if (detail !== null) return detail
    const message = failureMessage(typedFailure(error))
    return t(message.key, message.params ?? {})
  }
}

/**
 * The stored settings, and writes that keep the screen answering.
 *
 * What is shown is what was asked for last; `saved` is what the server last
 * confirmed, and a write that fails puts it back. No control is disabled while a
 * write is out, because a disabled control drops the keyboard's focus, so presses
 * can arrive during one. The record is written whole, so only the newest one needs
 * to go next, and writes never overlap, so an older one cannot land last.
 */
export function useAlertSettings(locale: () => string) {
  const { t } = useI18n()
  const failureText = useAlertFailureText()
  const saved = shallowRef<AlertSettings | null>(null)
  const shown = shallowRef<AlertSettings | null>(null)
  const loadFailed = ref(false)
  const failure = shallowRef<{ row: AlertSettingsRow; text: string } | null>(null)
  let next: { record: AlertSettings; row: AlertSettingsRow } | null = null
  let writing = false

  const panelState = computed<PlatformUiState<true>>(() => {
    if (shown.value !== null) return uiReady(PANEL_PAYLOAD)
    return loadFailed.value ? uiError('alerts.loadFailed') : uiLoading()
  })

  async function load() {
    loadFailed.value = false
    try {
      const settings = await fetchAlertSettings()
      saved.value = settings
      shown.value = settings
    } catch {
      loadFailed.value = true
    }
  }

  async function drain() {
    if (writing) return
    writing = true
    while (next !== null) {
      const { row, record } = next
      next = null
      try {
        const stored = await saveAlertSettings(record)
        saved.value = stored
        if (next === null) shown.value = stored
      } catch (error) {
        // A newer record carries this change too and is about to answer for it.
        if (next === null) {
          shown.value = saved.value
          failure.value = { row, text: failureText(error) }
        }
      }
    }
    writing = false
  }

  /** Change one row of the record; a language always comes along from the interface. */
  function update(row: AlertSettingsRow, change: Partial<AlertSettings>) {
    if (shown.value === null) return
    const language = locale() === 'ru' ? 'ru' : 'en'
    const record: AlertSettings = { ...shown.value, ...change, locale: language }
    shown.value = record
    failure.value = null
    next = { row, record }
    void drain()
  }

  function failureOf(row: AlertSettingsRow): string {
    return failure.value?.row === row ? t('alerts.saveFailed', { reason: failure.value.text }) : ''
  }

  // Toasts are written in the interface's language, so changing it here changes theirs.
  watch(locale, () => update('locale', {}))

  onMounted(load)

  return { settings: shown, panelState, load, update, failureOf }
}
