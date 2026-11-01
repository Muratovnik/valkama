<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import InspectorDescription from '@/widgets/work-item-inspector/components/InspectorDescription.vue'
import InspectorDiscussion from '@/widgets/work-item-inspector/components/InspectorDiscussion.vue'
import InspectorSummary from '@/widgets/work-item-inspector/components/InspectorSummary.vue'
import { checklistProgress } from '@/widgets/work-item-inspector/utils/inspectorActivity.ts'
import { openBlockers } from '@/widgets/work-item-inspector/utils/openBlockers.ts'

import ItemInputRequests from '@/features/input-requests/components/ItemInputRequests.vue'

import type { WorkItem } from '@/shared/api/planningModel.ts'
import type { PlanningTarget } from '@/shared/api/planningTarget.ts'
import { holderName } from '@/shared/lib/actor.ts'
import { semanticStatePresentation, statePresentation } from '@/shared/lib/uiSystem.ts'
import RichText from '@/shared/ui/RichText.vue'
import SectionHeader from '@/shared/ui/SectionHeader.vue'
import SectionHeading from '@/shared/ui/SectionHeading.vue'
import VButton from '@/shared/ui/VButton.vue'
import VIcon from '@/shared/ui/VIcon.vue'

const props = defineProps<{
  item: WorkItem
  writable: boolean
  target?: PlanningTarget
}>()

const emit = defineEmits<{
  changed: []
  refresh: []
  tick: [itemId: string, done: boolean]
}>()

const { t } = useI18n()
const discussion = ref<InstanceType<typeof InspectorDiscussion> | null>(null)
const checklistSection = ref<HTMLElement | null>(null)
function discussStep(stepId: string) {
  void discussion.value?.discussStep(stepId)
}

/** The report composer, opened as the item's outcome: what a closing guard asks for. */
function startOutcomeReport() {
  return discussion.value?.startReport()
}

function revealChecklist() {
  checklistSection.value?.scrollIntoView({ block: 'start' })
}

// A closed item is neither blocked nor waiting on a next step: both read as
// live instructions, and on a Done card they were stale ones.
const blockers = computed(() => openBlockers(props.item))
const nextStep = computed(() =>
  props.item.state.is_terminal ? undefined : props.item.checklist.find((step) => !step.done),
)
const steps = computed(() => checklistProgress(props.item))
const stepCount = computed(() =>
  steps.value.total ? t('workItem.checklistProgress', steps.value) : '',
)
function stepState(done: boolean) {
  return done ? 'done' : 'open'
}
/** A blocker as the facet registry words a wait: «Ждёт MAIN-12», then what it is. */
const blockerTone = semanticStatePresentation({
  dimension: 'work-item-readiness',
  state: 'blocked',
}).tone

defineExpose({ revealChecklist, startOutcomeReport })
</script>

<template>
  <div class="overview">
    <ul
      v-if="blockers.length"
      class="blockers"
    >
      <li
        v-for="link in blockers"
        :key="link.reference"
        class="blocker"
      >
        <VIcon
          class="blocker-glyph"
          name="waiting"
          :data-tone="blockerTone"
          :size="14"
          :stroke-width="2"
        />
        <RichText
          class="blocker-text"
          :source="`${t('workItem.facet.waiting', { reference: link.reference })} — ${link.title}`"
          inline
        />
      </li>
    </ul>
    <section
      v-if="nextStep"
      class="overview-section"
    >
      <SectionHeading
        as="h3"
        level="panel"
        >{{ t('workItem.summaryNext') }}</SectionHeading
      >
      <p>{{ nextStep?.text }}</p>
    </section>
    <!-- What the item is made of, which its host reads and owns. -->
    <slot name="composition" />

    <InspectorDescription
      :item="item"
      :writable="writable"
      @changed="emit('changed')"
      @refresh="emit('refresh')"
    />

    <section
      ref="checklistSection"
      class="overview-section"
    >
      <SectionHeader
        :title="t('workItem.checklist')"
        :count="stepCount"
      />
      <ul
        v-if="item.checklist.length"
        class="checklist"
      >
        <!-- The step, its one action at the row's end, and who holds or closed
             it directly under the step's own text. The action used to be a full
             button on a row of its own, so each holder line sat closer to the
             next step than to the one it described. -->
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
            :data-tone="statePresentation('checklist-step', stepState(step.done)).tone"
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
          <VButton
            v-if="writable"
            class="step-discuss"
            variant="ghost"
            size="inline"
            :title="t('checklistComment.discuss')"
            :aria-label="t('checklistComment.discussStep', { step: step.text })"
            icon
            @click="discussStep(step.id)"
          >
            <VIcon
              name="message-square"
              :size="16"
            />
          </VButton>
          <span
            v-if="step.claimed_by && !step.done"
            class="step-holder"
            >{{ t('workItem.stepHeldBy', { agent: holderName(step.claimed_by) }) }}</span
          >
          <span
            v-else-if="step.done && step.done_by"
            class="step-holder"
            >{{ t('workItem.stepDoneBy', { agent: holderName(step.done_by) }) }}</span
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

    <InspectorSummary :item="item" />
    <ItemInputRequests
      v-if="target"
      :target="target"
      @changed="emit('changed')"
    />
    <InspectorDiscussion
      ref="discussion"
      :item="item"
      :writable="writable"
      @changed="emit('changed')"
      @refresh="emit('refresh')"
    />
  </div>
</template>

<style scoped src="./InspectorOverview.css"></style>
