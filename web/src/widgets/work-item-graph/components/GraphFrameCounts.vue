<script setup lang="ts">
/**
 * How the work under a frame stands, in words, each number beside its word
 * rather than inside it. The counts are never cut: they take a second line
 * first. They count the epic, not the view, so what a filter or «Open» hides is
 * in these numbers too, and only an epic nothing was filed under says it has no
 * tasks.
 */
import { computed } from 'vue'
import { Translation, useI18n } from 'vue-i18n'

import { countedGroups } from '@/widgets/work-item-graph/utils/graphFrames.ts'
import type { FrameProgress } from '@/widgets/work-item-graph/utils/graphGeometry.ts'

import CountBadge from '@/shared/ui/CountBadge.vue'

const { progress } = defineProps<{ progress: FrameProgress }>()
const { t } = useI18n()

/** A frame's counts are its epic's whole size, which no badge's «99+» may round off. */
const WHOLE = Number.MAX_SAFE_INTEGER

const groups = computed(() => countedGroups(progress))

/**
 * A count's word, after a space: the gap beside the number is drawn, and the
 * space is what copied text and a reader of the plain row get.
 */
function word(group: (typeof groups.value)[number]['group'], count: number): string {
  const name = t(`graph.frame.${group}`, count)
  return ` ${name}`
}
</script>

<template>
  <span class="graph-frame-counts">
    <span
      v-if="progress.total === 0"
      class="graph-frame-count"
      >{{ t('graph.frame.noTasks') }}</span
    >
    <Translation
      v-else
      class="graph-frame-count"
      keypath="graph.frame.doneOf"
      tag="span"
    >
      <template #done>
        <CountBadge
          placement="inline"
          :limit="WHOLE"
          :value="progress.done"
        />
      </template>
      <template #total>
        <CountBadge
          placement="inline"
          :limit="WHOLE"
          :value="progress.total"
        />
      </template>
    </Translation>
    <span
      v-for="{ group, count } in groups"
      :key="group"
      class="graph-frame-count"
      :data-group="group"
      ><CountBadge
        placement="inline"
        :limit="WHOLE"
        :value="count"
      />{{ word(group, count) }}</span
    >
  </span>
</template>

<style scoped>
/* The header holds them to the width a folded header gives them, so they break at
   one place whether the frame is folded or open. */
.graph-frame-counts {
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  gap: 0 var(--space-2);
}

.graph-frame-count {
  display: inline-flex;
  flex: 0 0 auto;
  gap: var(--space-1);
  align-items: baseline;
  white-space: nowrap;
}
</style>
