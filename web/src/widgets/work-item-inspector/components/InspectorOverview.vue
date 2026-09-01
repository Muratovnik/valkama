<script setup lang="ts">
/**
 * What one work item is, and the two things that decide whether it can close.
 *
 * The checklist and the closing summary are here rather than behind a dialog
 * because the terminal guard refuses on exactly those two, and an operator told
 * "every step must be closed" should be looking at the steps. The summary form
 * is its own component because it is the only part of this panel that holds
 * state rather than showing the record.
 *
 * The reserved sections at the bottom are their own component, which is where
 * the argument for naming them lives.
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import InspectorReserved from '@/widgets/work-item-inspector/components/InspectorReserved.vue'
import InspectorSummary from '@/widgets/work-item-inspector/components/InspectorSummary.vue'
import { checklistProgress } from '@/widgets/work-item-inspector/utils/inspectorActivity.ts'

import type { WorkItem } from '@/shared/api/planningModel.ts'
import { actorName } from '@/shared/lib/actor.ts'
import { openSourceReference, sourceFeedback } from '@/shared/lib/sourceReference.ts'
import { statePresentation } from '@/shared/lib/uiSystem.ts'
import type { PlanningSpaceEntityRef } from '@/shared/types/reference.ts'
import SectionHeading from '@/shared/ui/SectionHeading.vue'
import VIcon from '@/shared/ui/VIcon.vue'

const props = defineProps<{
  item: WorkItem
  resourceRef: PlanningSpaceEntityRef
  writable: boolean
}>()

const emit = defineEmits<{
  summary: [value: { done: string; next: string; why: string }]
  tick: [itemId: string, done: boolean]
}>()

const { t, d } = useI18n()

const steps = computed(() => checklistProgress(props.item))
/** Who holds the item, or the phrase for nobody — never a blank cell. */
const claimLabel = computed(() =>
  props.item.claim_ref ? actorName(props.item.claim_ref) : t('workItem.noClaim'),
)

/**
 * Opening the anchor, and what to say when the shell could not.
 *
 * The desktop shell opens a validated local reference; a browser has no
 * local-file authority, so it copies the path and says so. Both are useful and
 * only one of them is silent, which is why the note exists at all.
 */
const sourceNote = ref('')

async function openSource() {
  const result = await openSourceReference({
    source: props.item.source,
    resource_ref: props.resourceRef,
  })
  const outcome = sourceFeedback(result)
  if (outcome === 'copied') sourceNote.value = t('source.copied')
  else if (outcome === 'failed')
    sourceNote.value = t('source.failed', { message: result.error ?? '' })
  else sourceNote.value = ''
}

function when(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? value : d(date, 'activity')
}
</script>

<template>
  <div class="overview">
    <dl class="facts">
      <div class="fact">
        <dt class="fact-term">{{ t('workItem.state') }}</dt>
        <dd
          class="fact-value fact-state"
          :data-tone="statePresentation('work-item-state', props.item.state.category).tone"
        >
          {{ item.state.name }}
        </dd>
      </div>
      <div class="fact">
        <dt class="fact-term">{{ t('workItem.priority') }}</dt>
        <dd class="fact-value">{{ t(`priority.${item.priority}`) }}</dd>
      </div>
      <div class="fact">
        <dt class="fact-term">{{ t('workItem.kindLabel') }}</dt>
        <dd class="fact-value">{{ t(`workItem.kind.${item.kind}`) }}</dd>
      </div>
      <div class="fact">
        <dt class="fact-term">{{ t('workItem.claim') }}</dt>
        <dd class="fact-value">
          {{ claimLabel }}
        </dd>
      </div>
      <div class="fact">
        <dt class="fact-term">{{ t('workItem.updated') }}</dt>
        <dd class="fact-value">{{ when(item.updated_at) }}</dd>
      </div>
      <div
        v-if="item.source"
        class="fact fact-wide"
      >
        <dt class="fact-term">{{ t('workItem.source') }}</dt>
        <dd class="fact-value fact-source">
          <button
            class="source-anchor"
            type="button"
            :title="t('source.open')"
            @click="openSource"
          >
            {{ item.source }}
          </button>
          <small
            v-if="sourceNote"
            class="source-notice"
            role="status"
            >{{ sourceNote }}</small
          >
        </dd>
      </div>
    </dl>

    <ul
      v-if="item.labels.length"
      class="labels"
    >
      <li
        v-for="label in item.labels"
        :key="label"
        class="label"
      >
        {{ label }}
      </li>
    </ul>

    <section v-if="item.description">
      <SectionHeading
        as="h3"
        level="panel"
        >{{ t('workItem.description') }}</SectionHeading
      >
      <p class="description">{{ item.description }}</p>
    </section>

    <section>
      <div class="section-line">
        <SectionHeading
          as="h3"
          level="panel"
          >{{ t('workItem.checklist') }}</SectionHeading
        >
        <span
          v-if="steps.total"
          class="section-count"
          >{{ t('workItem.checklistProgress', steps) }}</span
        >
      </div>
      <ul
        v-if="item.checklist.length"
        class="checklist"
      >
        <li
          v-for="step in item.checklist"
          :key="step.id"
          class="step-row"
        >
          <!-- A checkbox, not a toggle button: a step is done or not done, and
               `aria-pressed` would announce it as a control that stays in. -->
          <button
            class="step"
            type="button"
            role="checkbox"
            :class="{ done: step.done }"
            :disabled="!writable"
            :aria-checked="step.done"
            @click="emit('tick', step.id, !step.done)"
          >
            <span
              class="step-mark"
              aria-hidden="true"
            >
              <VIcon
                v-if="step.done"
                name="check"
                :size="13"
              />
            </span>
            <span class="step-text">{{ step.text }}</span>
          </button>
          <span
            v-if="step.claimed_by && !step.done"
            class="step-holder"
            >{{ t('workItem.stepHeldBy', { agent: actorName(step.claimed_by) }) }}</span
          >
          <span
            v-else-if="step.done && step.done_by"
            class="step-holder"
            >{{ t('workItem.stepDoneBy', { agent: actorName(step.done_by) }) }}</span
          >
        </li>
      </ul>
      <p
        v-else
        class="quiet"
      >
        {{ t('workItem.noChecklist') }}
      </p>
    </section>

    <InspectorSummary
      :item="item"
      :writable="writable"
      @summary="(value) => emit('summary', value)"
    />

    <InspectorReserved />
  </div>
</template>

<style scoped>
.overview {
  display: grid;
  gap: var(--space-5);
}

/* Several columns of short facts, each a term over its value. A single column
   made the drawer scroll past five one-word answers before the description. */
.facts {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(132px, 1fr));
  gap: var(--space-3) var(--space-4);
  margin: 0;
}

.fact {
  display: grid;
  gap: var(--space-hair);
  min-width: 0;
}

.fact-wide {
  grid-column: 1 / -1;
}

.fact-term {
  color: var(--color-text-tertiary);
  font: var(--font-detail);
}

.fact-value {
  margin: 0;
  color: var(--color-text);
  font: var(--font-line);
}

.fact-state {
  display: inline-flex;
  gap: var(--space-2);
  align-items: baseline;
}

.fact-state::before {
  content: '';
  width: 7px;
  height: 7px;
  background: var(--color-text-muted);
  border-radius: 50%;
}

.fact-state[data-tone='info']::before {
  background: var(--color-info);
}

.fact-state[data-tone='success']::before {
  background: var(--color-success);
}

.fact-state[data-tone='warning']::before {
  background: var(--color-warning);
}

.fact-state[data-tone='danger']::before {
  background: var(--color-danger);
}

.source-anchor {
  padding: 0;
  border: 0;
  color: var(--color-action-primary);
  font: inherit;
  text-align: start;
  overflow-wrap: anywhere;
  background: none;
  cursor: pointer;

  &:hover,
  &:focus-visible {
    text-decoration: underline;
  }
}

.source-notice {
  display: block;
  margin-top: var(--space-1);
  color: var(--color-text-muted);
  font: var(--font-note);
}

.fact-source {
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}

.labels {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1) var(--space-2);
  padding: 0;
  margin: 0;
  list-style: none;
}

.label {
  padding: 0 var(--space-1);
  color: var(--color-text-muted);
  font: var(--font-detail);
  background: var(--color-surface-recess);
  border-radius: var(--radius-status);
}

.section-line {
  display: flex;
  gap: var(--space-2);
  justify-content: space-between;
  align-items: baseline;
}

.section-count {
  color: var(--color-text-muted);
  font: var(--font-count);
  font-variant-numeric: tabular-nums;
}

.description {
  margin: 0;
  color: var(--color-text);
  font: var(--font-line);
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.quiet {
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-detail);
}

.checklist {
  display: grid;
  gap: var(--space-2);
  padding: 0;
  margin: 0;
  list-style: none;
}

/* The step is one control: the box and its text toggle together, because a
   7px hit target beside a sentence is a target nobody can use. */
.step {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: var(--space-2);
  align-items: start;
  width: 100%;
  padding: 0;
  border: 0;
  text-align: start;
  background: none;
  cursor: pointer;

  &:disabled {
    cursor: default;
  }

  &:focus-visible {
    outline: 2px solid var(--color-focus-ring);
    outline-offset: 2px;
  }
}

.step-mark {
  display: grid;
  place-items: center;
  width: 16px;
  height: 16px;
  border: 1px solid var(--color-rule-strong);
  color: var(--color-surface);
  border-radius: var(--radius-status);

  .step.done & {
    background: var(--color-accent);
    border-color: var(--color-accent);
  }
}

.step-text {
  color: var(--color-text);
  font: var(--font-line);
  overflow-wrap: anywhere;

  .step.done & {
    color: var(--color-text-muted);
    text-decoration: line-through;
  }
}

/* The holder sits under the step, indented to the step's text column, so a name
   never competes with the step it belongs to. */
.step-holder {
  display: block;
  padding-inline-start: var(--space-6);
  color: var(--color-text-tertiary);
  font: var(--font-detail);
}
</style>
