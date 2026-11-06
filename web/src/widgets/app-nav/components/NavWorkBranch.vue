<script setup lang="ts">
/**
 * One level of the side panel's tree: its rows, and under each group's head the level
 * below it, drawn by this same component, so the tree goes as deep as the frame's
 * parents do.
 *
 * A group's head is a disclosure (WAI-ARIA APG, disclosure navigation): its fold says
 * whether what it controls is shown, and Enter and Space on it fold or open. Each group
 * names its node and its fold on its item, which is how Escape finds the innermost open
 * group around focus (`NavWorkTree`).
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import NavWorkRow from '@/widgets/app-nav/components/NavWorkRow.vue'
import type { NavNode, NavOpen } from '@/widgets/app-nav/composables/useNavOpen.ts'
import type { LiveNode } from '@/widgets/app-nav/utils/liveTree.ts'

import type { PlatformRoute } from '@/shared/api/platformRoute.ts'

const props = defineProps<{
  current: string | null
  depth: number
  nodes: readonly LiveNode[]
  open: NavOpen
  /** Ids in this tree start with it: the rail's tree and the panel's can stand at once. */
  prefix: string
  size: 'rail' | 'touch'
  /** A number as wide as the list's longest (`NavWorkTree`). */
  widest: string
  route: (reference: string) => PlatformRoute | null
}>()

const emit = defineEmits<{ go: [route: PlatformRoute] }>()

const { t } = useI18n()

const node = (live: LiveNode): NavNode => `group:${live.row.reference}`
const branchId = (live: LiveNode) => `${props.prefix}-${live.row.reference}`
const foldId = (live: LiveNode) => `${props.prefix}-${live.row.reference}-fold`
const isGroup = (live: LiveNode) => live.children.length > 0
const isOpen = (live: LiveNode) => props.open.isOpen(node(live))
const isCurrent = (live: LiveNode) => props.current === live.row.reference
const deeper = computed(() => props.depth + 1)

/** What a group's item says Escape works on: its node and its fold. */
function groupMarks(live: LiveNode) {
  return isGroup(live) ? { 'data-nav-node': node(live), 'data-nav-fold': foldId(live) } : {}
}

function fold(live: LiveNode) {
  if (!isGroup(live)) return null
  return {
    id: foldId(live),
    controls: branchId(live),
    label: t('liveWork.group', { name: `${live.row.reference} ${live.row.title}` }),
    open: isOpen(live),
  }
}

function toggle(live: LiveNode) {
  props.open.set(node(live), !isOpen(live))
}
</script>

<template>
  <ul class="nav-branch">
    <li
      v-for="live in nodes"
      :key="live.row.reference"
      class="nav-branch-node"
      v-bind="groupMarks(live)"
    >
      <NavWorkRow
        :row="live.row"
        :depth="depth"
        :size="size"
        :current="isCurrent(live)"
        :route="route(live.row.reference)"
        :fold="fold(live)"
        :widest="widest"
        @fold="toggle(live)"
        @go="(next) => emit('go', next)"
      />
      <NavWorkBranch
        v-if="isGroup(live)"
        v-show="isOpen(live)"
        :id="branchId(live)"
        :current="current"
        :depth="deeper"
        :nodes="live.children"
        :open="open"
        :prefix="prefix"
        :route="route"
        :size="size"
        :widest="widest"
        @go="(next) => emit('go', next)"
      />
    </li>
  </ul>
</template>

<style scoped>
.nav-branch {
  display: grid;
  gap: var(--space-half);
  padding: 0;
  margin: 0;
  list-style: none;
}

.nav-branch-node {
  display: grid;
  gap: var(--space-half);
}
</style>
