<script setup lang="ts">
/**
 * The card's body, inside the card's own layer of reference links.
 *
 * Every section of the card shows text an agent wrote, and a reference in any
 * of them means the same thing: so the layer is provided once, around all of
 * them, and the record a commit or memory link opens is shown from here. Its
 * root is the card's body, a column that fills the drawer.
 */
import InspectorRefPeek from '@/widgets/work-item-inspector/components/InspectorRefPeek.vue'
import { useInspectorReferenceLinks } from '@/widgets/work-item-inspector/utils/useInspectorReferenceLinks.ts'

import type { WorkItem } from '@/shared/api/planningModel.ts'

const props = defineProps<{
  item: WorkItem | null
  /** The card's planning space, by its exact identity, for commits and paths. */
  space?: string
}>()
const emit = defineEmits<{ open: [reference: string] }>()

const { peeked } = useInspectorReferenceLinks({
  item: () => props.item,
  openFrom: (reference) => emit('open', reference),
  space: () => props.space,
})
</script>

<template>
  <article class="inspector-scope">
    <slot />
    <InspectorRefPeek
      v-if="peeked"
      :record="peeked"
      :space="space"
      @close="peeked = null"
    />
  </article>
</template>

<style scoped>
.inspector-scope {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 100%;
}
</style>
