<script setup lang="ts">
/**
 * What a question says about itself in the list of everything waiting, where nothing around
 * it does: whose task it is, its title, and the attempt and session that asked.
 *
 * The task's number is a link to it, drawn as a number is in any text, with the same card on
 * a pointer at rest. It opens the very task the question came with rather than whatever a
 * search finds by that number, since two stores can hold the same key.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import type { InputRequestEntry } from '@/shared/api/inputRequestModel.ts'
import type { PlanningTarget } from '@/shared/api/planningTarget.ts'
import { projectTitle, useProjectTitles } from '@/shared/lib/projectTitles.ts'
import { provideReferenceLinks } from '@/shared/lib/referenceLinks.ts'
import RichText from '@/shared/ui/RichText.vue'
import SectionHeading from '@/shared/ui/SectionHeading.vue'

const props = defineProps<{ entry: InputRequestEntry }>()
const emit = defineEmits<{ select: [target: PlanningTarget] }>()
const { t } = useI18n()
const request = computed(() => props.entry.request)
/** Project, and the space where the reference does not already begin with its key. */
const projects = useProjectTitles()
const place = computed(() => {
  const { project_id: id, space_ref: space } = props.entry.target
  const project = projectTitle(projects.value, id)
  return request.value.reference.startsWith(`${space.space_key}-`)
    ? project
    : `${project} · ${space.space_key}`
})
provideReferenceLinks((reference, parent) => {
  if (reference.kind !== 'work-item' || reference.value !== request.value.reference)
    return parent(reference)
  return {
    ...(parent(reference) ?? { title: t('textLinks.openItem', { reference: reference.value }) }),
    open: () => emit('select', props.entry.target),
  }
})
</script>

<template>
  <header class="request-header">
    <p class="request-context">
      {{ place }} ·
      <RichText
        :source="request.reference"
        inline
      />
    </p>
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
