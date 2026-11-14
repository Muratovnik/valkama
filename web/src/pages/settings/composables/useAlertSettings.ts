import { computed, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { useStoredRecord } from '@/pages/settings/composables/useStoredRecord.ts'

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

/** The stored alert settings, written through the page's one write queue. */
export function useAlertSettings(locale: () => string) {
  const { t } = useI18n()
  const stored = useStoredRecord<AlertSettings, AlertSettingsRow>({
    read: fetchAlertSettings,
    write: saveAlertSettings,
    failureText: useAlertFailureText(),
  })
  const settings = stored.record

  const panelState = computed<PlatformUiState<true>>(() => {
    if (settings.value !== null) return uiReady(PANEL_PAYLOAD)
    return stored.loadFailed.value ? uiError('alerts.loadFailed') : uiLoading()
  })

  /** Change one row of the record; a language always comes along from the interface. */
  function update(row: AlertSettingsRow, change: Partial<AlertSettings>) {
    if (settings.value === null) return
    const language = locale() === 'ru' ? 'ru' : 'en'
    stored.put(row, { ...settings.value, ...change, locale: language })
  }

  function failureOf(row: AlertSettingsRow): string {
    const reason = stored.failureOf(row)
    return reason ? t('alerts.saveFailed', { reason }) : ''
  }

  // Toasts are written in the interface's language, so changing it here changes theirs.
  watch(locale, () => update('locale', {}))

  onMounted(stored.load)

  return { settings, panelState, load: stored.load, update, failureOf }
}
