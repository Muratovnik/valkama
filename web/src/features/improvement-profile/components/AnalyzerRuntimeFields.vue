<script setup lang="ts">
import { computed, useId } from 'vue'
import { useI18n } from 'vue-i18n'

import { ANALYZER_EFFORTS } from '@/entities/improvement/utils/improvementDerivations.ts'
import type { AnalyzerEffort } from '@/entities/improvement/utils/improvementDerivations.ts'

import type { ChoiceOption } from '@/shared/ui/choiceControls.ts'
import SelectionControl from '@/shared/ui/SelectionControl.vue'
import VField from '@/shared/ui/VField.vue'
import VTextInput from '@/shared/ui/VTextInput.vue'

const props = defineProps<{
  client: 'codex' | 'claude'
  effort: AnalyzerEffort
  model: string
}>()
const emit = defineEmits<{
  'update:effort': [value: AnalyzerEffort]
  'update:model': [value: string]
}>()
const { t } = useI18n()
const modelListId = `analyzer-models-${useId()}`
const modelSuggestions = computed(() =>
  props.client === 'codex' ? ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'] : [],
)
/**
 * The list this field completes from, or nothing when there is nothing to suggest.
 *
 * A `list` pointing at an empty datalist is a combobox that opens on nothing, so
 * the attribute has to be absent rather than empty when the client ships no
 * suggestions of its own.
 */
const modelListMark = computed(() => (modelSuggestions.value.length ? modelListId : undefined))
const effortOptions = computed<ChoiceOption[]>(() =>
  ANALYZER_EFFORTS.map((item) => ({
    value: item,
    label: item || t('improvements.clientDefault'),
  })),
)
</script>

<template>
  <div class="runtime-fields">
    <div class="runtime-model">
      <VTextInput
        :model-value="model"
        :label="t('launch.model')"
        :list="modelListMark"
        :maxlength="120"
        :placeholder="t('improvements.clientDefault')"
        @update:model-value="emit('update:model', $event)"
      />
      <datalist
        v-if="modelSuggestions.length"
        :id="modelListId"
      >
        <option
          v-for="item in modelSuggestions"
          :key="item"
          :value="item"
        />
      </datalist>
    </div>
    <VField
      as="div"
      :label="t('launch.effort')"
    >
      <SelectionControl
        mode="combobox"
        :model-value="effort"
        :options="effortOptions"
        :label="t('launch.effort')"
        @update:model-value="emit('update:effort', $event as AnalyzerEffort)"
      />
    </VField>
  </div>
</template>

<style scoped>
.runtime-fields {
  display: grid;
  grid-template-columns: 1fr;
  gap: var(--space-4);
  min-width: 0;
}

.runtime-model {
  min-width: 0;
}

@container overlay (width >= 600px) {
  .runtime-fields {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
