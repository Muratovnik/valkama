<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import InspectorDescription from '@/widgets/work-item-inspector/components/InspectorDescription.vue'
import InspectorDiscussion from '@/widgets/work-item-inspector/components/InspectorDiscussion.vue'
import InspectorSummary from '@/widgets/work-item-inspector/components/InspectorSummary.vue'
import { checklistProgress } from '@/widgets/work-item-inspector/utils/inspectorActivity.ts'

import ItemInputRequests from '@/features/input-requests/components/ItemInputRequests.vue'

import type { WorkItem } from '@/shared/api/planningModel.ts'
import type { PlanningTarget } from '@/shared/api/planningTarget.ts'
import { isWebAuthor } from '@/shared/api/webAuthor.ts'
import { actorName } from '@/shared/lib/actor.ts'
import { openSourceReference, sourceFeedback } from '@/shared/lib/sourceReference.ts'
import { statePresentation } from '@/shared/lib/uiSystem.ts'
import type { PlanningSpaceEntityRef } from '@/shared/types/reference.ts'
import SectionHeader from '@/shared/ui/SectionHeader.vue'
import SectionHeading from '@/shared/ui/SectionHeading.vue'
import SemanticState from '@/shared/ui/SemanticState.vue'
import VButton from '@/shared/ui/VButton.vue'
import VIcon from '@/shared/ui/VIcon.vue'

const props = defineProps<{
  item: WorkItem
  resourceRef: PlanningSpaceEntityRef
  writable: boolean
  target?: PlanningTarget
}>()

const emit = defineEmits<{
  changed: []
  refresh: []
  tick: [itemId: string, done: boolean]
}>()

const { t, d } = useI18n()
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
const blockers = computed(() =>
  props.item.state.is_terminal
    ? []
    : props.item.links.filter((link) => link.kind === 'blocks' && link.direction === 'incoming'),
)
const nextStep = computed(() =>
  props.item.state.is_terminal ? undefined : props.item.checklist.find((step) => !step.done),
)
const steps = computed(() => checklistProgress(props.item))
const stepCount = computed(() =>
  steps.value.total ? t('workItem.checklistProgress', steps.value) : '',
)
function stepState(done: boolean) {
  return done ? 'selected' : 'unselected'
}
/** Who holds the item, or the phrase for nobody — never a blank cell. */
const claimLabel = computed(() =>
  props.item.claim_ref ? actorName(props.item.claim_ref) : t('workItem.noClaim'),
)
const ownerLabel = computed(() =>
  t(props.item.state.is_terminal ? 'workItem.previousOwner' : 'workItem.owner'),
)
/**
 * Whether anyone is still behind the claim, and until when. Shown only while
 * the item is open: on a finished item the holder is history and its lease
 * says nothing a reader could act on. Nor for this client's own claim: no
 * session ever stands behind it, and telling the owner that nobody confirmed
 * their own claim would read as a fault.
 */
const lease = computed(() => {
  const claim = props.item.claim
  if (props.item.state.is_terminal || !claim || isWebAuthor(claim.holder)) return null
  return claim
})
const leaseDetail = computed(() => {
  const claim = lease.value
  if (!claim) return ''
  if (claim.state === 'live' && claim.expires_at)
    return t('workItem.lease.liveDetail', { date: when(claim.expires_at) })
  if (claim.state === 'stale') return t('workItem.lease.staleDetail')
  return t('workItem.lease.unconfirmedDetail')
})

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

defineExpose({ revealChecklist, startOutcomeReport })
</script>

<template>
  <div class="overview">
    <section
      v-if="blockers.length"
      class="overview-section"
    >
      <SectionHeading
        as="h3"
        level="panel"
        >{{ t('workItem.queue.blocked') }}</SectionHeading
      >
      <p
        v-for="link in blockers"
        :key="link.reference"
      >
        {{ link.reference }} — {{ link.title }}
      </p>
    </section>
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
    <dl class="facts">
      <div class="fact">
        <dt class="fact-term">{{ t('workItem.state') }}</dt>
        <dd class="fact-value">
          <SemanticState
            class="fact-state"
            dimension="work-item-state"
            :state="item.state.category"
            :label="item.state.name"
          />
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
        <dt class="fact-term">
          {{ ownerLabel }}
        </dt>
        <dd class="fact-value">
          {{ claimLabel }}
        </dd>
      </div>
      <div
        v-if="lease"
        class="fact"
      >
        <dt class="fact-term">{{ t('workItem.lease.label') }}</dt>
        <dd class="fact-value">
          <SemanticState
            class="fact-state"
            dimension="claim-lease"
            :state="lease.state"
            :label="t(`workItem.lease.${lease.state}`)"
          />
          <small class="lease-detail">{{ leaseDetail }}</small>
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
            :data-tone="statePresentation('control-selection', stepState(step.done)).tone"
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
