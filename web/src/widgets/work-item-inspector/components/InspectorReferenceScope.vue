<script setup lang="ts">
/**
 * The card's body, inside the card's own layer of reference links.
 *
 * Every section of the card shows text an agent wrote, and a reference in any
 * of them means the same thing: so the layer is provided once, around all of
 * them, and the commit or the memory record a link opens is shown from here. Its
 * root is the card's body, a column that fills the drawer.
 */
import InspectorCommitPeek from '@/widgets/work-item-inspector/components/InspectorCommitPeek.vue'
import InspectorRefPeek from '@/widgets/work-item-inspector/components/InspectorRefPeek.vue'
import { useInspectorReferenceLinks } from '@/widgets/work-item-inspector/utils/useInspectorReferenceLinks.ts'

import type { WorkItem } from '@/shared/api/planningModel.ts'

const props = defineProps<{
  item: WorkItem | null
  /** The card's planning space, by its exact identity, for paths. */
  space?: string
}>()
const emit = defineEmits<{ open: [reference: string] }>()

const { commit, peeked } = useInspectorReferenceLinks({
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
      @close="peeked = null"
    />
    <InspectorCommitPeek
      v-if="commit"
      :commit="commit"
      @close="commit = null"
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
