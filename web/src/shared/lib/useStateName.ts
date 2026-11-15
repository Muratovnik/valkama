/**
 * `stateName` bound to the interface's language and the owner's choice, read when a name is
 * asked for: a render that names a state redraws when either changes, with no reload.
 */
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'

import type { ContainerState } from '@/shared/api/planningModel.ts'
import { stateName } from '@/shared/lib/stateNames.ts'
import type { NamedState } from '@/shared/lib/stateNames.ts'
import { useSettingsStore } from '@/shared/stores/settingsStore.ts'

export function useStateName(): (state: NamedState) => string {
  const { t } = useI18n()
  const { settings } = storeToRefs(useSettingsStore())
  return (state) => stateName(state, settings.value.stateNames, (message) => t(message))
}

/** Where an item stands: a state, or what an accepted open goal or stage derives instead. */
export interface StandingItem {
  state: NamedState | null
  container_state?: ContainerState | null
}

/**
 * What an item's standing is drawn as: its state's category, or, for an accepted open goal or
 * stage, the state it derives — both keys of the work-item-state presentation (`uiSystem`).
 */
export const standingOf = (item: StandingItem): string =>
  item.state?.category ?? item.container_state ?? ''

/**
 * The words for where an item stands: its state's name, or, for an accepted open goal or
 * stage, which stands in no state, what it derives from the work under it.
 */
export function useStandingName(): (item: StandingItem) => string {
  const { t } = useI18n()
  const name = useStateName()
  return (item) =>
    item.state === null
      ? t(`workItem.containerState.${item.container_state ?? 'not_started'}`)
      : name(item.state)
}
