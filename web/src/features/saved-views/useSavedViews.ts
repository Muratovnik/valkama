import { storeToRefs } from 'pinia'
import { computed } from 'vue'

import { activeView, deleteView, saveView, viewsOf, viewState } from '@/shared/lib/savedViews.ts'
import type { SavedViews, ViewState } from '@/shared/lib/savedViews.ts'
import { useSettingsStore } from '@/shared/stores/settingsStore.ts'

/**
 * The views saved in one place and what can be done with them, kept in the owner's
 * settings with every other preference of this machine, so a reload and every
 * window read the same list.
 *
 * `place` names where they were saved; the caller decides what makes two places one.
 */
export function useSavedViews(place: () => string, state: () => ViewState | undefined) {
  const { settings } = storeToRefs(useSettingsStore())
  const saved = () => settings.value.views
  const write = (views: SavedViews) => {
    settings.value = { ...settings.value, views }
  }

  const views = computed(() => viewsOf(saved(), place()))
  /** The view whose state the address holds now, which the list marks as chosen. */
  const active = computed(() => activeView(saved(), place(), state()))

  return {
    views,
    active,
    /** The address state now, under this name; a name already saved takes the new state. */
    save: (name: string) => write(saveView(saved(), place(), name, state() ?? {})),
    remove: (name: string) => write(deleteView(saved(), place(), name)),
    /** The state to write back for the view of this name, or null if there is none. */
    stateOf: (name: string) => viewState(saved(), place(), name),
  }
}
