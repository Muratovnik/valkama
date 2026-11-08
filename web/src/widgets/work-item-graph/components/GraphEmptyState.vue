<script setup lang="ts">
/**
 * Why the field is empty, and the control that would fill it, said through the shared
 * empty state: this decides which empty it is and what it offers, never how it looks.
 *
 * Two different empties: a space with no work at all, and a space whose work is
 * all done and hidden. The second names what is hidden and offers it, so an
 * empty field never reads as a broken one.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import DataEmptyState from '@/shared/ui/DataEmptyState.vue'
import VButton from '@/shared/ui/VButton.vue'

const props = defineProps<{
  /** How many items the reveal would bring back. */
  count: number
  kind: 'open' | 'space'
}>()

const emit = defineEmits<{ reveal: [] }>()
const { t } = useI18n()

const message = computed(() => t(props.kind === 'space' ? 'graph.empty' : 'graph.emptyOpen'))
const action = computed(() => t('graph.showDone', { count: props.count }))
</script>

<template>
  <DataEmptyState
    class="graph-empty"
    :title="message"
  >
    <template
      v-if="kind === 'open'"
      #action
    >
      <VButton
        size="inline"
        @click="emit('reveal')"
      >
        {{ action }}
      </VButton>
    </template>
  </DataEmptyState>
</template>

<style scoped>
/* It stands where the field would, in the room the field would take. */
.graph-empty {
  flex: 1 1 auto;
}
</style>
