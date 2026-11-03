<script setup lang="ts">
/**
 * What a question says about itself in the list of everything waiting, where nothing around
 * it does: whose task it is, its title, and the attempt and session that asked.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import type { InputRequestEntry } from '@/shared/api/inputRequestModel.ts'
import { projectTitle, useProjectTitles } from '@/shared/lib/projectTitles.ts'
import SectionHeading from '@/shared/ui/SectionHeading.vue'

const props = defineProps<{ entry: InputRequestEntry }>()
const { t } = useI18n()
const request = computed(() => props.entry.request)
/** Project and task; the space key is left out where the reference already begins with it. */
const projects = useProjectTitles()
const context = computed(() => {
  const { project_id: id, space_ref: space } = props.entry.target
  const project = projectTitle(projects.value, id)
  const reference = request.value.reference
  return reference.startsWith(`${space.space_key}-`)
    ? `${project} · ${reference}`
    : `${project} · ${space.space_key} · ${reference}`
})
</script>

<template>
  <header class="request-header">
    <p class="request-context">{{ context }}</p>
    <SectionHeading
      class="request-title"
      as="h3"
      level="panel"
      tabindex="-1"
      >{{ request.title }}</SectionHeading
    >
    <p
      v-if="request.execution_id"
      class="request-fact"
    >
      {{ t('requests.execution', { id: request.execution_id }) }}
    </p>
    <p
      v-if="request.session_id"
      class="request-fact"
    >
      {{ t('requests.session', { id: request.session_id }) }}
    </p>
  </header>
</template>

<style scoped>
.request-header {
  display: grid;
  gap: var(--space-1);
}

.request-title {
  overflow-wrap: anywhere;
}

/* The list moves focus here, to the next question, and rings it as it does (`moveFocus`). A
   press on it takes focus too, and rings nothing. The ring is the base one, clear of the words. */
.request-title:focus-visible {
  border-radius: var(--radius-control);
  outline-offset: var(--space-1);
}

.request-context,
.request-fact {
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-detail);
  overflow-wrap: anywhere;
}
</style>
