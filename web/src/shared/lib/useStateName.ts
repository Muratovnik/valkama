/**
 * `stateName` bound to the interface's language and the owner's choice, read when a name is
 * asked for: a render that names a state redraws when either changes, with no reload.
 */
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'

import { stateName } from '@/shared/lib/stateNames.ts'
import type { NamedState } from '@/shared/lib/stateNames.ts'
import { useSettingsStore } from '@/shared/stores/settingsStore.ts'

export function useStateName(): (state: NamedState) => string {
  const { t } = useI18n()
  const { settings } = storeToRefs(useSettingsStore())
  return (state) => stateName(state, settings.value.stateNames, (message) => t(message))
}
