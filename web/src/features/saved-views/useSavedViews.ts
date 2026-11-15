import { storeToRefs } from 'pinia'
import { computed, watch } from 'vue'

import {
  activeView,
  deleteView,
  keepReadViews,
  saveView,
  viewsOf,
  viewState,
  withDropped,
  withoutDropped,
} from '@/shared/lib/savedViews.ts'
import type { SavedViews, ViewState } from '@/shared/lib/savedViews.ts'
import { useSettingsStore } from '@/shared/stores/settingsStore.ts'

/**
 * The views saved in one place and what can be done with them, kept in the owner's
 * settings with every other preference of this machine, so a reload and every
 * window read the same list.
 *
 * `place` names where they were saved; the caller decides what makes two places one.
 * `reads` says whether this build reads a view's state as it was saved. A view it does
 * not read would open as another view under the old name, so it is removed from the
 * settings as soon as it is seen, and its name is kept there in its stead, in the same
 * write, until the caller has said so once and calls `acknowledge`. The name outlives
 * whoever read it: a reload or a screen left before its menu opened still names it.
 */
export function useSavedViews(
  place: () => string,
  state: () => ViewState | undefined,
  reads?: (state: ViewState) => boolean,
) {
  const { settings } = storeToRefs(useSettingsStore())
  const saved = () => settings.value.views
  const write = (views: SavedViews) => {
    settings.value = { ...settings.value, views }
  }

  if (reads)
    watch(
      [place, saved],
      ([where, views]) => {
        const kept = keepReadViews(views, where, reads)
        if (!kept.dropped.length) return
        settings.value = {
          ...settings.value,
          views: kept.views,
          droppedViews: withDropped(settings.value.droppedViews, where, kept.dropped),
        }
      },
      { immediate: true },
    )

  const views = computed(() => viewsOf(saved(), place()))
  /** The view whose state the address holds now, which the list marks as chosen. */
  const active = computed(() => activeView(saved(), place(), state()))
  const dropped = computed(() => settings.value.droppedViews[place()] ?? [])

  return {
    views,
    active,
    /** The names of the views removed as unread, until they have been named once. */
    dropped,
    acknowledge: () => {
      if (!dropped.value.length) return
      settings.value = {
        ...settings.value,
        droppedViews: withoutDropped(settings.value.droppedViews, place()),
      }
    },
    /** The address state now, under this name; a name already saved takes the new state. */
    save: (name: string) => write(saveView(saved(), place(), name, state() ?? {})),
    remove: (name: string) => write(deleteView(saved(), place(), name)),
    /** The state to write back for the view of this name, or null if there is none. */
    stateOf: (name: string) => viewState(saved(), place(), name),
  }
}
