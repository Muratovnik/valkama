<script setup lang="ts">
/**
 * The findings of a group a triage review proposes as one goal, each a row with its box, all
 * ticked at first: a finding left unticked leaves the group and goes back to triage, whichever
 * answer is given. Ticking only ticks; the kind's answers send what is ticked (`ticked`), and the
 * answer that takes the group on names how many go once some are unticked.
 *
 * The rows are a question's (`RequestOption`). The server recommends every finding, which is
 * what ticks them at first, so no row carries the word a recommended option does: on every row
 * it would set none apart.
 */
import { computed } from 'vue'

import RequestOption from '@/features/input-requests/components/RequestOption.vue'
import { ticked } from '@/features/input-requests/utils/questionRecord.ts'
import type { Ticks } from '@/features/input-requests/utils/questionRecord.ts'
import { editField } from '@/features/input-requests/utils/validateAnswers.ts'
import type { RequestDraft } from '@/features/input-requests/utils/validateAnswers.ts'

import type { InputRequestField } from '@/shared/api/inputRequestModel.ts'

const props = defineProps<{
  disabled: boolean
  draft: RequestDraft
  field: InputRequestField
  /** The heading that names the rows as a group. */
  labelledBy: string
  ticks: Ticks
}>()
const emit = defineEmits<{ 'update:draft': [draft: RequestDraft] }>()
/** Each finding as its row shows it, and whether it stands ticked. */
const rows = computed(() => {
  const now = new Set(ticked(props.ticks, props.draft))
  return props.field.options.map((option) => ({
    option: { ...option, recommended: false },
    ticked: now.has(option.id),
  }))
})
function tick(option: string, event: Event) {
  const { checked } = event.target as HTMLInputElement
  const stays = (row: (typeof rows.value)[number]) =>
    row.option.id === option ? checked : row.ticked
  const kept = rows.value.filter((row) => stays(row)).map((row) => row.option.id)
  emit('update:draft', editField(props.draft, props.ticks.field, { value: kept }))
}
</script>

<template>
  <div
    class="request-findings"
    role="group"
    :aria-labelledby="labelledBy"
    data-findings
  >
    <RequestOption
      v-for="row in rows"
      :key="row.option.id"
      view="none"
      :chosen="row.ticked"
      :disabled="disabled"
      :option="row.option"
      pressable
    >
      <template #default="{ labelId }">
        <input
          class="request-option-input"
          type="checkbox"
          :value="row.option.id"
          :checked="row.ticked"
          :disabled="disabled"
          :aria-labelledby="labelId"
          @change="tick(row.option.id, $event)"
        />
      </template>
    </RequestOption>
  </div>
</template>

<style scoped>
/* The rows stand a step apart, as a form's options do. */
.request-findings {
  display: grid;
  gap: var(--space-1);
  min-width: 0;
}
</style>
