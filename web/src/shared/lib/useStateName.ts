/**
 * `stateName` bound to the interface's language and the owner's choice, read when a name is
 * asked for: a render that names a state redraws when either changes, with no reload.
 */
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'

import { standingOf } from '@/shared/lib/standing.ts'
import type { StandingItem } from '@/shared/lib/standing.ts'
import { stateName } from '@/shared/lib/stateNames.ts'
import type { NamedState } from '@/shared/lib/stateNames.ts'
import { useSettingsStore } from '@/shared/stores/settingsStore.ts'

export function useStateName(): (state: NamedState) => string {
  const { t } = useI18n()
  const { settings } = storeToRefs(useSettingsStore())
  return (state) => stateName(state, settings.value.stateNames, (message) => t(message))
}

/**
 * The words for where an item stands: its state's name, or, for an accepted open goal or
 * stage, which stands in no state, what it derives from the work under it.
 */
export function useStandingName(): (item: StandingItem) => string {
  const { t } = useI18n()
  const name = useStateName()
  return (item) =>
    item.state === null ? t(`workItem.containerState.${standingOf(item)}`) : name(item.state)
}
