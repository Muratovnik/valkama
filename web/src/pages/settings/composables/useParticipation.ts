import { computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { useStoredRecord } from '@/pages/settings/composables/useStoredRecord.ts'
import { applyParticipation, rowOf } from '@/pages/settings/utils/participationChanges.ts'
import type { ParticipationRow } from '@/pages/settings/utils/participationChanges.ts'

import {
  fetchParticipation,
  participationRefusal,
  writeParticipation,
} from '@/shared/api/participationApi.ts'
import type {
  Participation,
  ParticipationChange,
  ParticipationEdit,
} from '@/shared/api/participationApi.ts'
import { uiError, uiLoading, uiReady } from '@/shared/api/platformUiState.ts'
import type { PlatformUiState } from '@/shared/api/platformUiState.ts'
import { failureMessage, typedFailure } from '@/shared/api/typedFailure.ts'

const PANEL_PAYLOAD = true as const

type ScopeRecord = ReturnType<
  typeof useStoredRecord<Participation, ParticipationRow, ParticipationChange>
>

/** Why a write did not hold: the server's words for a refusal, otherwise the product's. */
export function useSettingFailureText() {
  const { t } = useI18n()
  return (error: unknown): string => {
    const reason = participationRefusal(error) ?? translated(error)
    return t('settings.participation.saveFailed', { reason })
  }
  function translated(error: unknown): string {
    const message = failureMessage(typedFailure(error))
    return t(message.key, message.params ?? {})
  }
}

/**
 * The participation of the scope on show: the shared values (`space` null) or one space's.
 *
 * Each scope keeps its own record and its own queue, because a write answers with the read of
 * its own scope: a change still on its way when the person turns to the other scope lands in
 * the record it was made in. A scope is read again each time it comes on show, since a space
 * inherits the shared values and they may have changed meanwhile.
 */
export function useParticipation(space: () => string | null) {
  const failureText = useSettingFailureText()
  const records = new Map<string, ScopeRecord>()

  function scopeRecord(scope: string | null): ScopeRecord {
    return useStoredRecord<Participation, ParticipationRow, ParticipationChange>({
      read: () => fetchParticipation(scope),
      write: writeParticipation,
      apply: applyParticipation,
      // A row's change takes its own place: a set, a value or a label is written alone.
      slotOf: (row) => row,
      failureText,
    })
  }

  function recordOf(scope: string | null) {
    const name = scope ?? ''
    let found = records.get(name)
    if (found === undefined) {
      found = scopeRecord(scope)
      records.set(name, found)
    }
    return found
  }

  const stored = computed<ScopeRecord>(() => recordOf(space()))
  const participation = computed<Participation | null>(() => stored.value.record.value)
  const panelState = computed<PlatformUiState<true>>(() => {
    if (participation.value !== null) return uiReady(PANEL_PAYLOAD)
    return stored.value.loadFailed.value
      ? uiError('settings.participation.loadFailed')
      : uiLoading()
  })

  watch(space, () => void stored.value.load(), { immediate: true })

  /** Write one change of the scope on show. */
  function change(edit: ParticipationEdit) {
    stored.value.put(rowOf(edit), { ...edit, space: space() })
  }

  return {
    participation,
    panelState,
    load: () => stored.value.load(),
    change,
    failureOf: (row: ParticipationRow) => stored.value.failureOf(row),
  }
}
