<script setup lang="ts">
/**
 * The view's menu beside «Kanban / List / Graph»: how the view arranges what it
 * draws, and the views saved in the space.
 *
 * The board's grouping is a choice here and no button of its own in the bar: «By
 * epic» stood among the filter's presets and read as a filter, when it narrows
 * nothing. The menu offers only what applies to the view on the stage, so the list
 * and the graph have no grouping in it.
 *
 * A saved view is the address state under a name (`useSavedViews`): choosing one
 * writes its state back, as any change of the view, the grouping or the filter
 * does, and the view whose state the address holds now is the one checked. Saving
 * asks for a name in a small dialog; the view checked can be deleted.
 */
import { computed, onBeforeUnmount, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import type { BoardGrouping } from '@/widgets/work-item-views/utils/boardLanes.ts'

import SaveViewDialog from '@/features/saved-views/SaveViewDialog.vue'
import { useSavedViews } from '@/features/saved-views/useSavedViews.ts'

import type { ViewState } from '@/shared/lib/savedViews.ts'
import type { MenuEntry } from '@/shared/ui/menuEntries.ts'
import VMenu from '@/shared/ui/VMenu.vue'

const props = defineProps<{
  /** How the board is grouped; null while the board is not on the stage. */
  grouping: BoardGrouping | null
  /** Where views are saved: one planning space. */
  place: string
  /** The module's address state now. */
  state: ViewState | undefined
}>()

const emit = defineEmits<{
  group: [grouping: BoardGrouping]
  /** A saved view chosen: the address state to write. */
  state: [state: ViewState]
}>()

const { t } = useI18n()

const saved = useSavedViews(
  () => props.place,
  () => props.state,
)
const naming = ref(false)

const GROUPINGS: readonly BoardGrouping[] = ['none', 'epic']
/** How long «Save view…» waits for the menu to give focus back before it opens anyway. */
const FOCUS_BACK_MS = 300

function apply(name: string) {
  const state = saved.stateOf(name)
  if (state) emit('state', state)
}

/**
 * «Save view…» asks for the name once the menu has closed and given focus back to
 * its button, so the dialog's field keeps the focus it takes. The menu gives it back
 * on a timer of its own after it is gone (Reka's focus scope), which a dialog opened
 * on the next tick or the next frame still lost to; so the dialog waits for that
 * focus to arrive, and opens anyway if it never does.
 */
let asked = false
let fallback = 0
function openNaming() {
  if (!asked) return
  asked = false
  window.clearTimeout(fallback)
  naming.value = true
}
function startNaming() {
  asked = true
  fallback = window.setTimeout(openNaming, FOCUS_BACK_MS)
}
onBeforeUnmount(() => window.clearTimeout(fallback))

function save(name: string) {
  saved.save(name)
  naming.value = false
}

const entries = computed<MenuEntry[]>(() => {
  const grouping = props.grouping
  const names = saved.views.value.map((view) => view.name)
  const active = saved.active.value
  return [
    ...(grouping === null
      ? []
      : [
          {
            kind: 'choice' as const,
            key: 'grouping',
            label: t('workItem.viewMenu.grouping'),
            value: grouping,
            options: GROUPINGS.map((value) => ({
              value,
              label: t(
                value === 'epic' ? 'workItem.viewMenu.groupEpic' : 'workItem.viewMenu.groupNone',
              ),
            })),
            select: (value: string) => emit('group', value === 'epic' ? 'epic' : 'none'),
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
      select: startNaming,
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
  <span
    class="view-menu"
    @focusin="openNaming"
  >
    <span class="view-menu-words">
      <VMenu
        size="compact"
        icon="settings"
        align="start"
        :label="t('workItem.viewMenu.label')"
        :entries="entries"
        words
      />
    </span>
    <span class="view-menu-sign">
      <VMenu
        size="compact"
        icon="settings"
        align="start"
        :label="t('workItem.viewMenu.label')"
        :entries="entries"
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
