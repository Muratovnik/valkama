<script setup lang="ts">
/**
 * The pointers this project's work already carries.
 *
 * The half of the page that needs no provider. An attached pointer is Valkama's
 * own row with the label stored beside it, so it still reads when the source
 * behind it is unreachable — which is exactly when a reader is looking, and the
 * reason MEM-001 stores a label rather than resolving one.
 *
 * Every row names the work item it belongs to, because that is the question a
 * list of pointers actually raises: not what was attached, but to what.
 */
import { useI18n } from 'vue-i18n'

import type { MemoryLink } from '@/shared/api/memoryApi.ts'
import type { WorkItemNavigationTarget } from '@/shared/types/reference.ts'
import DataEmptyState from '@/shared/ui/DataEmptyState.vue'
import SectionHeading from '@/shared/ui/SectionHeading.vue'
import VButton from '@/shared/ui/VButton.vue'

defineProps<{ links: readonly MemoryLink[]; truncated: boolean }>()

const emit = defineEmits<{ 'open-work-item': [target: WorkItemNavigationTarget] }>()

const { t } = useI18n()

function open(link: MemoryLink) {
  emit('open-work-item', {
    planning_space: link.space_key,
    reference: link.work_item_key,
  })
}
</script>

<template>
  <section class="memory-links">
    <header>
      <SectionHeading as="h3">{{ t('memoryPage.links.heading') }}</SectionHeading>
      <p class="memory-quiet">{{ t('memoryPage.links.intro') }}</p>
    </header>

    <DataEmptyState
      v-if="links.length === 0"
      :title="t('memoryPage.links.none')"
      :description="t('memoryPage.links.noneDetail')"
    />
    <ul
      v-else
      class="link-list"
    >
      <li
        v-for="link in links"
        :key="`${link.work_item_id}:${link.value}`"
        class="link-row"
      >
        <span class="link-label">{{ link.label || link.value }}</span>
        <VButton
          variant="ghost"
          @click="open(link)"
        >
          {{ link.work_item_key }}
        </VButton>
        <p class="link-detail">{{ link.value }}</p>
        <p class="link-detail">{{ link.work_item_title }}</p>
      </li>
    </ul>
    <p
      v-if="truncated"
      class="memory-quiet"
    >
      {{ t('memoryPage.links.truncated') }}
    </p>
  </section>
</template>

<style scoped>
.memory-links {
  display: grid;
  gap: var(--space-4);
  min-width: 0;
}

.memory-quiet {
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-detail);
  overflow-wrap: anywhere;
}

.link-list {
  display: grid;
  gap: var(--space-4);
  padding: 0;
  margin: 0;
  list-style: none;
}

.link-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: var(--space-hair) var(--space-3);
  align-items: baseline;
  min-width: 0;
}

.link-label {
  color: var(--color-text);
  font: var(--font-row-title);
  overflow-wrap: anywhere;
}

.link-detail {
  grid-column: 1 / -1;
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-detail);
  overflow-wrap: anywhere;
}
</style>
