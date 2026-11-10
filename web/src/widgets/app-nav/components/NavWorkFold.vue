<script setup lang="ts">
/**
 * Work the side panel keeps out of the way under one row named by what it holds: «N more
 * with working sessions», «N more waiting for hours» or «N more silent for over a day».
 *
 * The row is a disclosure (WAI-ARIA APG): it starts folded, says whether its rows are
 * shown, and Enter and Space open or fold them. They open in place, under the row, so
 * nothing above it moves; the numbers' column was sized with them already (`NavWorkTree`).
 * Its rows keep to one line. Its node and its fold stand on its root, which is how Escape
 * finds it around focus, and the device keeps whether it is open, each fold on its own.
 *
 * It stands on the grid of the rows it folds: its arrow in their lead's column and its
 * words where their numbers start, from the lead the list declares (`--nav-tree-lead`,
 * `--nav-tree-arrow-end`).
 */
import { computed } from 'vue'

import NavWorkRows from '@/widgets/app-nav/components/NavWorkRows.vue'
import type { NavNode } from '@/widgets/app-nav/composables/useNavOpen.ts'
import type { LiveEntry } from '@/widgets/app-nav/utils/liveList.ts'

import type { PlatformRoute } from '@/shared/api/platformRoute.ts'
import { vTooltip } from '@/shared/ui/tooltipAnchors.ts'
import VIcon from '@/shared/ui/VIcon.vue'

const props = defineProps<{
  current: string | null
  entries: readonly LiveEntry[]
  /** The id of the row that folds them, and of the list it shows. */
  foldId: string
  listId: string
  node: NavNode
  open: boolean
  size: 'rail' | 'touch'
  widest: string
  /** What the row says: how many it holds, and what they are. */
  words: string
  route: (reference: string) => PlatformRoute | null
}>()

const emit = defineEmits<{ go: [route: PlatformRoute]; toggle: [] }>()

const touch = computed(() => props.size === 'touch')
</script>

<template>
  <div
    class="nav-fold"
    :class="{ 'nav-fold-touch': touch }"
    :data-nav-node="node"
    :data-nav-fold="foldId"
  >
    <button
      :id="foldId"
      v-tooltip:right.clipped="words"
      class="nav-fold-toggle"
      type="button"
      :aria-expanded="open"
      :aria-controls="listId"
      @click="emit('toggle')"
    >
      <span class="nav-fold-lead">
        <VIcon
          class="nav-fold-chevron"
          name="chevron-right"
          :size="14"
        />
      </span>
      <span class="nav-fold-words one-line">{{ words }}</span>
    </button>
    <NavWorkRows
      v-show="open"
      :id="listId"
      :entries="entries"
      :current="current"
      :lines="1"
      :route="route"
      :size="size"
      :widest="widest"
      @go="(next) => emit('go', next)"
    />
  </div>
</template>

<style scoped>
.nav-fold {
  display: grid;
  gap: var(--space-half);
}

/* A row's box, one step in from the space as a row is (`NavWorkRow`). It is a fold and
   not a place, so its words are quieter than a row's title. */
.nav-fold-toggle {
  display: grid;
  grid-template-columns: var(--nav-tree-lead, 24px) minmax(0, 1fr);
  gap: var(--space-1);
  align-items: center;
  width: 100%;
  min-height: var(--size-control-inline);
  padding-block: 0;
  padding-inline: calc(var(--space-3) + var(--space-1)) var(--space-1);
  border: 0;
  color: var(--color-navigation-text-muted);
  font: var(--font-detail);
  text-align: start;
  background: none;
  border-radius: var(--radius-control);
  cursor: pointer;

  &:hover {
    color: var(--color-text-on-dark);
    background: var(--color-navigation-raised);
  }

  &:focus-visible {
    outline-offset: -2px;
  }

  &[aria-expanded='true'] .nav-fold-chevron {
    rotate: 90deg;
  }
}

.nav-fold-lead {
  display: inline-flex;
  justify-content: center;
  align-items: center;
  padding-inline-end: calc(var(--nav-tree-arrow-end, 0px));
}

.nav-fold-chevron {
  transition: rotate var(--duration-quick) var(--ease-out);

  @media (prefers-reduced-motion: reduce) {
    transition: none;
  }
}

/* A phone: a finger's row and the reading size, as its rows have. */
.nav-fold-touch .nav-fold-toggle {
  min-height: var(--size-control-target);
  font: var(--font-control);
}
</style>
