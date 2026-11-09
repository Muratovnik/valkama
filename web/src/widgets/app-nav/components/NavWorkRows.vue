<script setup lang="ts">
/**
 * A run of the side panel's rows, one under another, all one step in from their space: the
 * work at hand, the quiet work under its fold, or the pinned items (`NavWorkTree`).
 */
import NavWorkRow from '@/widgets/app-nav/components/NavWorkRow.vue'
import type { LiveEntry } from '@/widgets/app-nav/utils/liveList.ts'

import type { PlatformRoute } from '@/shared/api/platformRoute.ts'

const props = defineProps<{
  /** The reference of the card on show in this space, if any. */
  current: string | null
  entries: readonly LiveEntry[]
  size: 'rail' | 'touch'
  /** A number as wide as the list's longest (`NavWorkTree`). */
  widest: string
  route: (reference: string) => PlatformRoute | null
}>()

const emit = defineEmits<{ go: [route: PlatformRoute] }>()

const isCurrent = (entry: LiveEntry) => props.current === entry.row.reference
const routeOf = (entry: LiveEntry) => props.route(entry.row.reference)
</script>

<template>
  <ul class="nav-rows">
    <li
      v-for="entry in entries"
      :key="entry.row.reference"
    >
      <NavWorkRow
        :row="entry.row"
        :epic="entry.epic"
        :depth="1"
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
