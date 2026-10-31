<script setup lang="ts">
/**
 * The filter row over a recorded history: one search and the choices that
 * narrow it.
 *
 * Two sections had their own copy, and in both the search was a labelled field
 * while the choices beside it carried no visible label, so the search box stood
 * a label's height below them and the three never shared a line. Every control
 * here wears its label the same way, so the row is one line of fields, and it
 * becomes a column only when the drawer is too narrow to hold them side by side.
 */
import type { ChoiceOption } from '@/shared/ui/choiceControls.ts'
import ChoiceSelect from '@/shared/ui/ChoiceSelect.vue'
import VField from '@/shared/ui/VField.vue'
import VTextInput from '@/shared/ui/VTextInput.vue'

defineProps<{
  choices: readonly { id: string; label: string; options: readonly ChoiceOption[] }[]
  searchLabel: string
}>()

const query = defineModel<string>('query', { required: true })
const selected = defineModel<Record<string, string>>('selected', { required: true })

function choose(id: string, value: string) {
  selected.value = { ...selected.value, [id]: value }
}
</script>

<template>
  <div class="history-filter-bar">
    <VTextInput
      v-model="query"
      :label="searchLabel"
    />
    <VField
      v-for="choice in choices"
      :key="choice.id"
      as="div"
      :label="choice.label"
    >
      <ChoiceSelect
        :model-value="selected[choice.id] ?? ''"
        :label="choice.label"
        :options="choice.options"
        @update:model-value="(value) => choose(choice.id, value)"
      />
    </VField>
  </div>
</template>

<style scoped>
/* Columns of equal share and bottom-aligned, so a label that wraps to a second
   line lifts its own caption rather than dropping its control off the row. */
.history-filter-bar {
  display: grid;
  grid-auto-columns: minmax(0, 1fr);
  grid-auto-flow: column;
  gap: var(--space-3);
  align-items: end;
}

/* The drawer is the container that changes width; the window does not. */
@container overlay (width < 520px) {
  .history-filter-bar {
    grid-auto-flow: row;
  }
}
</style>
