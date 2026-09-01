<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { skillsViewOptions } from '@/pages/skills/utils/skillPresentation.ts'

import CountBadge from '@/shared/ui/CountBadge.vue'
import SegmentedControl from '@/shared/ui/SegmentedControl.vue'
import VButton from '@/shared/ui/VButton.vue'
import VIcon from '@/shared/ui/VIcon.vue'

defineProps<{
  loading: boolean
  projectCount: number
  skillCount: number
  view: 'catalog' | 'matrix'
}>()
const emit = defineEmits<{
  refresh: []
  view: [value: 'catalog' | 'matrix']
}>()
const { t } = useI18n()
const viewOptions = computed(() => skillsViewOptions(t))
</script>

<template>
  <div class="skills-toolbar">
    <div class="inventory-summary">
      <span class="inventory-fact">
        {{ t('skills.count') }}
        <CountBadge
          class="fact-count"
          placement="inline"
          :value="skillCount"
        />
      </span>
      <span class="inventory-fact">
        {{ t('skills.projectCount') }}
        <CountBadge
          class="fact-count"
          placement="inline"
          :value="projectCount"
        />
      </span>
    </div>
    <div class="skills-actions">
      <SegmentedControl
        :model-value="view"
        :options="viewOptions"
        :label="t('skills.viewLabel')"
        @update:model-value="(value) => emit('view', value)"
      />
      <VButton
        class="refresh-button"
        :disabled="loading"
        @click="emit('refresh')"
      >
        <VIcon
          name="refresh"
          :size="18"
        />
        {{ t('skills.refresh') }}
      </VButton>
    </div>
  </div>
</template>

<style scoped>
.skills-toolbar,
.inventory-summary,
.skills-actions {
  display: flex;
  align-items: center;
}

.skills-toolbar {
  gap: var(--space-4);
  justify-content: space-between;
}

.inventory-summary {
  gap: var(--space-6);
}

.skills-actions {
  gap: var(--space-2);
}

.inventory-fact {
  display: inline-flex;
  gap: var(--space-2);
  align-items: center;
  color: var(--color-text-muted);
  font-size: var(--font-size-dense);

  .fact-count {
    color: var(--color-text);
    font-size: var(--font-size-emphasis);
    font-weight: 600;
  }
}

.refresh-button:disabled {
  cursor: wait;
}

@container workspace (width <= 696px) {
  .skills-toolbar,
  .skills-actions {
    display: grid;
  }

  .inventory-summary {
    flex-wrap: wrap;
    gap: var(--space-2) var(--space-4);
  }

  .refresh-button {
    width: 100%;
  }
}
</style>
