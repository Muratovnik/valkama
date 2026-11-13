<script setup lang="ts">
/**
 * The list's own find (`useListFind.ts`) around the list it searches: the list
 * is the slot, and its bar (`WorkItemListFindBar.vue`) stands over it while it is
 * open, under the head and clear of the scroll bar, at the room this frame
 * measures for both. The list hands over its scroller, its rows in their order
 * and the words each row prints (`listRowWords.ts`).
 */
import { computed, shallowRef, toRef, useTemplateRef } from 'vue'
import type { Ref } from 'vue'

import { useResizeObserver } from '@vueuse/core'

import WorkItemListFindBar from '@/widgets/work-item-views/components/WorkItemListFindBar.vue'
import { useListFind } from '@/widgets/work-item-views/composables/useListFind.ts'

import type { WorkItemBrief } from '@/shared/api/planningModel.ts'

const props = defineProps<{
  /** The list's window: where a row stands, how to bring it in, how tall the head is. */
  list: {
    headSize: Readonly<Ref<number>>
    center: (index: number) => void
    placeOf: (id: string) => number
  }
  /** The element that scrolls the rows. */
  root: HTMLElement | null
  rows: readonly WorkItemBrief[]
  /** The words a row prints, run by run, as it prints them. */
  words: (item: WorkItemBrief) => readonly string[]
}>()

const bar = useTemplateRef<InstanceType<typeof WorkItemListFindBar>>('bar')
const root = toRef(() => props.root)

/** The scroll bar's width, which the bar keeps clear of. */
const gutter = shallowRef(0)
useResizeObserver(root, () => {
  const element = root.value
  gutter.value = element ? element.offsetWidth - element.clientWidth - 2 * element.clientLeft : 0
})
const room = computed(() => ({
  '--list-gutter': `${gutter.value}px`,
  '--list-head-size': `${props.list.headSize.value}px`,
}))

const { at, close, input, open, searching, step, total, type } = useListFind<WorkItemBrief>({
  bar: () => bar.value?.element() ?? null,
  focusBar: () => bar.value?.focus(),
  key: (item) => item.work_item_id,
  list: {
    center: (index) => props.list.center(index),
    placeOf: (id) => props.list.placeOf(id),
  },
  root,
  rows: () => props.rows,
  words: (item) => props.words(item),
})
</script>

<template>
  <div
    class="work-item-list-frame"
    :style="room"
  >
    <slot />
    <WorkItemListFindBar
      v-if="open"
      ref="bar"
      :model-value="input"
      :at="at"
      :searching="searching"
      :total="total"
      @update:model-value="type"
      @step="step"
      @close="close"
    />
  </div>
</template>

<style scoped>
/* The list and its find bar, which stands over the list rather than in its scroll.
   The room the bar keeps clear of, until the list is measured: a head a control
   tall, and no scroll bar. The bar asks this frame how wide the list is. */
.work-item-list-frame {
  --list-gutter: 0px;
  --list-head-size: var(--size-control-height);

  position: relative;
  display: grid;
  grid-template: minmax(0, 1fr) / minmax(0, 1fr);
  height: 100%;
  min-height: 0;
  container: work-list / inline-size;
}
</style>
