<script setup lang="ts">
/**
 * A run of the side panel's rows, one under another, all one step in from their space: the
 * work to follow now on two lines each, the work under a fold, or the pinned items
 * (`NavWorkTree`). A session's row has no card to lead to and is never the one on show.
 */
import NavWorkRow from '@/widgets/app-nav/components/NavWorkRow.vue'
import type { LiveEntry } from '@/widgets/app-nav/utils/liveList.ts'

import type { PlatformRoute } from '@/shared/api/platformRoute.ts'

const props = defineProps<{
  /** The reference of the card on show in this space, if any. */
  current: string | null
  entries: readonly LiveEntry[]
  lines: 1 | 2
  size: 'rail' | 'touch'
  /** A number as wide as the list's longest (`NavWorkTree`). */
  widest: string
  route: (reference: string) => PlatformRoute | null
}>()

const emit = defineEmits<{ go: [route: PlatformRoute] }>()

const keyOf = (entry: LiveEntry) =>
  entry.kind === 'item' ? entry.row.reference : `session:${entry.session.session}`
const isCurrent = (entry: LiveEntry) =>
  entry.kind === 'item' && props.current === entry.row.reference
const routeOf = (entry: LiveEntry) =>
  entry.kind === 'item' ? props.route(entry.row.reference) : null
</script>

<template>
  <ul class="nav-rows">
    <li
      v-for="entry in entries"
      :key="keyOf(entry)"
    >
      <NavWorkRow
        :entry="entry"
        :lines="lines"
        :size="size"
        :current="isCurrent(entry)"
        :route="routeOf(entry)"
        :widest="widest"
        @go="(next) => emit('go', next)"
      />
    </li>
  </ul>
</template>

<style scoped>
.nav-rows {
  display: grid;
  gap: var(--space-half);
  padding: 0;
  margin: 0;
  list-style: none;
}
</style>
