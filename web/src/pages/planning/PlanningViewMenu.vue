<script setup lang="ts">
/**
 * The view's menu beside «Kanban / List / Graph»: how the view arranges what it
 * draws, and the views saved in the space.
 *
 * The grouping is a choice here and no button of its own in the bar: «By goal»
 * stood among the filter's presets and read as a filter, when it narrows nothing.
 * The menu offers only what applies to the view on the stage: the board groups by
 * parent, the list by goal, as a tree, and the graph has no grouping in it.
 *
 * A saved view is the address state under a name (`useSavedViews`): choosing one
 * writes its state back, as any change of the view, the grouping or the filter
 * does, and the view whose state the address holds now is the one checked. Saving
 * asks for a name in a small dialog; the view checked can be deleted.
 *
 * A saved view holding a value this build does not read (`readsSavedView`) is removed
 * as soon as the space is open, and the menu names it the next time it opens, before
 * its entries; once that menu has closed, the note is gone.
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import type { ViewGrouping } from '@/pages/planning/composables/usePlanningChainScope.ts'
import { readsSavedView } from '@/pages/planning/utils/savedViewReads.ts'

import SaveViewDialog from '@/features/saved-views/SaveViewDialog.vue'
import { useSavedViews } from '@/features/saved-views/useSavedViews.ts'

import type { ViewState } from '@/shared/lib/savedViews.ts'
import type { MenuEntry } from '@/shared/ui/menuEntries.ts'
import VMenu from '@/shared/ui/VMenu.vue'

const props = withDefaults(
  defineProps<{
    /** How the view on the stage is grouped; null for a view with no grouping. */
    grouping: ViewGrouping | null
    /** Where views are saved: one planning space. */
    place: string
    /** The module's address state now. */
    state: ViewState | undefined
    /** The groupings the view on the stage offers: the board's unless it says. */
    groupings?: readonly ViewGrouping[]
  }>(),
  { groupings: () => ['none', 'goal'] },
)

const emit = defineEmits<{
  group: [grouping: ViewGrouping]
  /** A saved view chosen: the address state to write. */
  state: [state: ViewState]
}>()

const { t } = useI18n()

const saved = useSavedViews(
  () => props.place,
  () => props.state,
  readsSavedView,
)
const naming = ref(false)

const GROUPING_WORDS: Record<ViewGrouping, string> = {
  goal: 'workItem.viewMenu.groupGoal',
  none: 'workItem.viewMenu.groupNone',
}

function apply(name: string) {
  const state = saved.stateOf(name)
  if (state) emit('state', state)
}

function save(name: string) {
  saved.save(name)
  naming.value = false
}

const entries = computed<MenuEntry[]>(() => {
  const grouping = props.grouping
  const names = saved.views.value.map((view) => view.name)
  const active = saved.active.value
  const dropped = saved.dropped.value
  return [
    ...(dropped.length
      ? [
          {
            kind: 'note' as const,
            key: 'dropped',
            label: t(
              'workItem.viewMenu.dropped',
              {
                names: dropped
                  .map((name) => t('workItem.viewMenu.droppedName', { name }))
                  .join(', '),
              },
              dropped.length,
            ),
          },
        ]
      : []),
    ...(grouping === null
      ? []
      : [
          {
            kind: 'choice' as const,
            key: 'grouping',
            label: t('workItem.viewMenu.grouping'),
            value: grouping,
            options: props.groupings.map((value) => ({ value, label: t(GROUPING_WORDS[value]) })),
            select: (value: string) =>
              emit('group', props.groupings.find((option) => option === value) ?? 'none'),
          },
        ]),
    ...(names.length
      ? [
          {
            kind: 'choice' as const,
            key: 'views',
            label: t('workItem.viewMenu.saved'),
            value: active ?? '',
            options: names.map((name) => ({ value: name, label: name })),
            select: apply,
          },
        ]
      : []),
    {
      kind: 'action',
      key: 'save',
      label: t('workItem.viewMenu.save'),
      icon: 'plus',
      // The dialog takes focus from the menu's button and gives it back there (`VMenu`).
      opens: true,
      select: () => {
        naming.value = true
      },
    },
    ...(active === null
      ? []
      : [
          {
            kind: 'action' as const,
            key: 'delete',
            label: t('workItem.viewMenu.delete', { name: active }),
            icon: 'close',
            select: () => saved.remove(active),
          },
        ]),
  ]
})
const taken = computed(() => saved.views.value.map((view) => view.name))
</script>

<template>
  <!-- Its word where the row has room, its sign alone on a phone, where the field
       needs the room to stay usable: the bar's view switch folds the same way. -->
  <span class="view-menu">
    <span class="view-menu-words">
      <VMenu
        size="compact"
        icon="settings"
        align="start"
        :label="t('workItem.viewMenu.label')"
        :entries="entries"
        words
        @close="saved.acknowledge"
      />
    </span>
    <span class="view-menu-sign">
      <VMenu
        size="compact"
        icon="settings"
        align="start"
        :label="t('workItem.viewMenu.label')"
        :entries="entries"
        @close="saved.acknowledge"
      />
    </span>
  </span>
  <SaveViewDialog
    :open="naming"
    :taken="taken"
    @close="naming = false"
    @save="save"
  />
</template>

<style scoped>
.view-menu,
.view-menu-words {
  display: inline-flex;
  flex: none;
}

.view-menu-sign {
  display: none;
}

@container workspace (width <= 624px) {
  .view-menu-words {
    display: none;
  }

  .view-menu-sign {
    display: inline-flex;
  }
}
</style>
