<script setup lang="ts">
/**
 * What a block of questions says about itself in the list of everything waiting, where nothing
 * around it does: whose task it is, its title, and the attempt and session that asked.
 *
 * The head stays at the top of the panel while any of its block is in view, on the block's own
 * ground, so a reader deep in a long block still sees which one it is and has what acts on the
 * whole block under the hand (`actions`, the comment on the block): at the end of its first
 * line, as an entry's icons end its head. It sticks inside its block and leaves with the block's
 * end, and the next block's head takes its place. What else sticks to the top of that panel
 * stands under it (`height`, which the block hands on as `--size-stuck-top`), and nothing it
 * covers keeps focus under it (`data-stuck-edge`). The attempt and the session stay behind in
 * the flow: they say who asked, which is read once, and two lines of ids made every block's
 * head that much taller. It stands where the panel keeps what sticks (`--size-stuck-top`).
 *
 * The task's number is a link to it, drawn as a number is in any text, with the same card on
 * a pointer at rest, and it is the way to the task: a button for it in the foot said the same
 * again. It opens the very task the block came with rather than whatever a search finds by that
 * number, since two stores can hold the same key.
 *
 * The title names the block (`titleId`), which is what takes focus when the list moves on
 * to it: the title itself is words, and a ring round it stood as a capsule round one line.
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { useResizeObserver } from '@vueuse/core'

import type { InputRequestEntry } from '@/shared/api/inputRequestModel.ts'
import { planningTargetRoute } from '@/shared/api/planningTarget.ts'
import type { PlanningTarget } from '@/shared/api/planningTarget.ts'
import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'
import { projectTitle, useProjectTitles } from '@/shared/lib/projectTitles.ts'
import { provideReferenceLinks } from '@/shared/lib/referenceLinks.ts'
import LineEnd from '@/shared/ui/LineEnd.vue'
import RichText from '@/shared/ui/RichText.vue'
import SectionHeading from '@/shared/ui/SectionHeading.vue'

const props = defineProps<{
  entry: InputRequestEntry
  /** The id of the title, which names the question it stands over. */
  titleId: string
}>()
const emit = defineEmits<{ select: [target: PlanningTarget] }>()
const { t } = useI18n()
const head = ref<HTMLElement | null>(null)
/** How much of the panel's top the head covers while it sticks, its ground included. */
const height = ref(0)
useResizeObserver(head, ([entry]) => {
  height.value = entry?.borderBoxSize[0]?.blockSize ?? 0
})
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
    // The card's own route, not the number's short address: that one is found by a search.
    href: serializePlatformRoute(planningTargetRoute(props.entry.target)),
    open: () => emit('select', props.entry.target),
  }
})
defineExpose({ height })
</script>

<template>
  <header
    ref="head"
    class="request-header"
    data-stuck-edge="start"
  >
    <div class="request-header-line">
      <p class="request-context">
        {{ place }} ·
        <RichText
          :source="request.reference"
          inline
        />
      </p>
      <LineEnd class="request-header-actions"><slot name="actions" /></LineEnd>
    </div>
    <SectionHeading
      :id="titleId"
      class="request-title"
      as="h3"
      level="panel"
      >{{ request.title }}</SectionHeading
    >
  </header>
  <div
    v-if="request.execution_id || request.session_id"
    class="request-asker"
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
  </div>
</template>

<style scoped>
/* Over the block's own inset (`--request-sheet-inset`) to its edges, so that what passes under
   it is covered to the sheet's sides and its words stay where they stood. Its foot is the gap
   the block keeps between its rows, carried with it as ground. */
.request-header {
  position: sticky;
  inset-block-start: var(--size-stuck-top, 0);
  z-index: 2;
  display: grid;
  gap: var(--space-1);
  min-width: 0;
  padding: calc(var(--request-sheet-inset));
  padding-block-end: var(--space-2);
  margin-block: calc(-1 * var(--request-sheet-inset)) calc(-1 * var(--space-2));
  margin-inline: calc(-1 * var(--request-sheet-inset));
  background: var(--color-surface-sheet);
  border-start-start-radius: var(--radius-card);
  border-start-end-radius: var(--radius-card);

  /* A forced palette clears that ground, and with it the edge of what stays put. */
  @media (forced-colors: active) {
    outline: 1px solid CanvasText;
  }
}

/* The context and what acts on the block share the first line, the icon on its axis. */
.request-header-line {
  display: flex;
  gap: var(--space-2);
  align-items: first baseline;
  min-width: 0;
  font: var(--font-detail);
}

.request-header-actions:empty {
  display: none;
}

.request-title {
  overflow-wrap: anywhere;
}

.request-asker {
  display: grid;
  gap: var(--space-1);
}

.request-context,
.request-fact {
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-detail);
  overflow-wrap: anywhere;
}

.request-context {
  flex: 1 1 0;
  min-width: 0;
}
</style>
