<script setup lang="ts">
/**
 * Which provider answers for each project, and which cannot be asked at all.
 *
 * The plan calls this a provider selector, and a selector is the one thing it
 * must not be. A project's knowledge root is resolved from the registry rather
 * than chosen here, so a menu would be a control that decides nothing. What a
 * reader needs is the mapping itself: whose knowledge is reachable, where it
 * lives, and — for the ones that are not — the sentence that says why.
 *
 * A project that cannot answer is listed rather than omitted. Leaving it out
 * would read as a project with nothing to say, and "nothing to say" and "cannot
 * be asked" are different facts. This page exists mostly for the second.
 */
import { useI18n } from 'vue-i18n'

import type { MemoryProvider } from '@/shared/api/memoryApi.ts'
import DataEmptyState from '@/shared/ui/DataEmptyState.vue'
import SectionHeading from '@/shared/ui/SectionHeading.vue'
import SemanticState from '@/shared/ui/SemanticState.vue'
import VButton from '@/shared/ui/VButton.vue'

defineProps<{ providers: readonly MemoryProvider[] }>()

const emit = defineEmits<{ open: [projectId: string] }>()

const { t, te } = useI18n()

/** A project whose knowledge cannot be reached has nothing to open. */
function unreachable(provider: MemoryProvider): boolean {
  return provider.health !== 'ready'
}

function reasonLabel(provider: MemoryProvider): string {
  if (!provider.reason) return ''
  const key = `memoryPage.providers.reason.${provider.reason.code}`
  return te(key) ? t(key) : provider.reason.message
}
</script>

<template>
  <section class="memory-providers">
    <header>
      <SectionHeading as="h3">{{ t('memoryPage.providers.heading') }}</SectionHeading>
      <p class="memory-quiet">{{ t('memoryPage.providers.intro') }}</p>
    </header>

    <DataEmptyState
      v-if="providers.length === 0"
      :title="t('memoryPage.providers.none')"
      :description="t('memoryPage.providers.noneDetail')"
    />
    <ul
      v-else
      class="provider-list"
    >
      <li
        v-for="provider in providers"
        :key="provider.project_id"
        class="provider-row"
      >
        <div class="provider-identity">
          <SemanticState
            dimension="integration-health"
            :state="provider.health"
            :label="provider.title"
          />
          <span class="memory-quiet">{{ provider.provider_id }}</span>
        </div>
        <p
          v-if="provider.root"
          class="provider-root"
        >
          {{ provider.root }}
        </p>
        <p
          v-else-if="provider.reason"
          class="provider-root"
        >
          {{ reasonLabel(provider) }}
        </p>
        <VButton
          :disabled="unreachable(provider)"
          @click="emit('open', provider.project_id)"
        >
          {{ t('memoryPage.providers.open') }}
        </VButton>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.memory-providers {
  display: grid;
  gap: var(--space-4);
  min-width: 0;
}

.memory-quiet {
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-detail);
}

.provider-list {
  display: grid;
  gap: var(--space-4);
  padding: 0;
  margin: 0;
  list-style: none;
}

.provider-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: var(--space-2) var(--space-4);
  align-items: center;
}

.provider-identity {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-3);
  align-items: baseline;
  min-width: 0;
}

.provider-root {
  grid-column: 1;
  margin: 0;
  color: var(--color-text-tertiary);
  font: var(--font-detail);
  overflow-wrap: anywhere;
}
</style>
