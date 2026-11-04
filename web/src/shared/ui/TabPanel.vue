<script setup lang="ts">
/**
 * The panel a tab list shows, named by the tab that shows it (WAI-ARIA APG tabs).
 *
 * It holds whatever its host shows for the chosen tab and only says what it is; showing and
 * hiding stay the host's, since one host keeps a panel in the page while another one is up.
 * Without tab ids — an editor with its toolbar left out has no tabs — it is a group named
 * by `label`, or a plain block with none.
 *
 * It takes no Tab stop of its own. A card's and Settings' sections start at a control or
 * stand in a scroller the keyboard already reaches, where a stop on the whole panel would
 * stand between the tabs and the first thing in it; a host whose panel scrolls by itself
 * gives it one, as an editor gives its preview.
 */
import { computed } from 'vue'

import type { TabIds } from '@/shared/ui/tabIds.ts'

const props = defineProps<{
  /** The ids its tab list was given; absent where there is no tab list. */
  tabs: TabIds | null
  /** The tab this panel shows. */
  value: string
  /** What the panel is called where no tab names it. */
  label?: string
}>()

const named = computed(() => {
  if (props.tabs)
    return {
      'id': props.tabs.panel(props.value),
      'role': 'tabpanel',
      'aria-labelledby': props.tabs.tab(props.value),
    }
  return props.label ? { 'role': 'group', 'aria-label': props.label } : {}
})
</script>

<template>
  <div v-bind="named">
    <slot />
  </div>
</template>
