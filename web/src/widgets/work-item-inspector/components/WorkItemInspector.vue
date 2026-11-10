<script setup lang="ts">
/**
 * One work item, opened by its reference.
 *
 * The sections are Valkama's, not an adapter's: an adapter supplies records, and
 * never markup for a panel. Three are live at this layer and five are declared
 * empty inside Overview, which is what keeps the shell honest while later layers
 * are still being built.
 *
 * The panel around the card is the page's and outlives it: this is one instance
 * per item, and its drafts, its place and where it returns to go with the item.
 * The panel asks `close` before it closes, so its Escape and its scrim pass the
 * draft guard as the card's own Close does.
 *
 * The head scrolls with the content and reads as who the item is, then what holds
 * for it, then what to do: the identity line in the bar, the title under it, the
 * facts under that — the state as the menu that moves it, the priority and the epic,
 * then the holder with the one action at its end, then the labels — and the sections.
 * It used to put a full-width write row and a section before the facts, which started
 * half way down the drawer. The writes refuse rather than force: a refusal shows the
 * server's reason in the band under the bar, where it is seen however far down the
 * write was made, and overriding is a second, explicit answer rather than a default.
 *
 * A reference the service says names nothing is not a failure: there is nothing
 * to retry and no section to open. The card says so once, under a title that
 * already is the reference, with no identity line, no facts, no tabs and no
 * writes, and Close is the way on.
 *
 * The head waits for the read. Everything in it is sized by the record, so a head
 * drawn before the answer stood its title as a reference, with no facts and the tabs
 * under it, and moved all of that when the answer came. The bar's controls and the
 * waiting mark are all that stand until then, and a failed read gets the head back.
 */
import { computed, ref, toRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import InspectorActivity from '@/widgets/work-item-inspector/components/InspectorActivity.vue'
import InspectorAgents from '@/widgets/work-item-inspector/components/InspectorAgents.vue'
import InspectorChain from '@/widgets/work-item-inspector/components/InspectorChain.vue'
import InspectorControls from '@/widgets/work-item-inspector/components/InspectorControls.vue'
import InspectorExecution from '@/widgets/work-item-inspector/components/InspectorExecution.vue'
import InspectorFacts from '@/widgets/work-item-inspector/components/InspectorFacts.vue'
import InspectorIdentity from '@/widgets/work-item-inspector/components/InspectorIdentity.vue'
import InspectorMemory from '@/widgets/work-item-inspector/components/InspectorMemory.vue'
import InspectorNotices from '@/widgets/work-item-inspector/components/InspectorNotices.vue'
import InspectorOverview from '@/widgets/work-item-inspector/components/InspectorOverview.vue'
import InspectorReferenceScope from '@/widgets/work-item-inspector/components/InspectorReferenceScope.vue'
import InspectorRelations from '@/widgets/work-item-inspector/components/InspectorRelations.vue'
import InspectorTabs from '@/widgets/work-item-inspector/components/InspectorTabs.vue'
import InspectorTitle from '@/widgets/work-item-inspector/components/InspectorTitle.vue'
import InspectorWriteActions from '@/widgets/work-item-inspector/components/InspectorWriteActions.vue'
import { agentCount } from '@/widgets/work-item-inspector/utils/agentUsage.ts'
import { followGuard } from '@/widgets/work-item-inspector/utils/guardStep.ts'
import type { InspectorReturn } from '@/widgets/work-item-inspector/utils/inspectorReturn.ts'
import { inspectorTarget } from '@/widgets/work-item-inspector/utils/inspectorTarget.ts'
import { provideDraftGuard } from '@/widgets/work-item-inspector/utils/useDraftGuard.ts'
import { useFailureText } from '@/widgets/work-item-inspector/utils/useFailureText.ts'
import { useInspectorExecution } from '@/widgets/work-item-inspector/utils/useInspectorExecution.ts'
import { useInspectorRecord } from '@/widgets/work-item-inspector/utils/useInspectorRecord.ts'
import { useInspectorReturn } from '@/widgets/work-item-inspector/utils/useInspectorReturn.ts'
import { useInspectorSections } from '@/widgets/work-item-inspector/utils/useInspectorSections.ts'
import { useInspectorWrites } from '@/widgets/work-item-inspector/utils/useInspectorWrites.ts'
import { useQuestionReveal } from '@/widgets/work-item-inspector/utils/useQuestionReveal.ts'
import { useTakeoverQuestion } from '@/widgets/work-item-inspector/utils/useTakeoverQuestion.ts'
import { useWorkItemChain } from '@/widgets/work-item-inspector/utils/useWorkItemChain.ts'

import { provideMissingPlaces } from '@/features/session-open/missingPlaces.ts'
import LaunchDialog from '@/features/work-item-launch/LaunchDialog.vue'

import type { WorkFilterToken } from '@/entities/work-item/utils/workFilter.ts'

import type { InputRequestEntry } from '@/shared/api/inputRequestModel.ts'
import type { ChainScope, WorkItemChain } from '@/shared/api/planningChainApi.ts'
import type { PlanningWorkflow, WorkItemBrief } from '@/shared/api/planningModel.ts'
import { typedFailure } from '@/shared/api/typedFailure.ts'
import type { PlanningSpaceEntityRef } from '@/shared/types/reference.ts'
import DataEmptyState from '@/shared/ui/DataEmptyState.vue'
import DrawerFrame from '@/shared/ui/DrawerFrame.vue'
import PlatformStatePanel from '@/shared/ui/PlatformStatePanel.vue'
import TabPanel from '@/shared/ui/TabPanel.vue'
import VButton from '@/shared/ui/VButton.vue'

const props = defineProps<{
  /** True while a related item was opened from inside this drawer. */
  canGoBack: boolean
  /** The project this item belongs to; empty in a global scope. */
  projectId: string
  reference: string
  refreshToken: number
  resourceRef: PlanningSpaceEntityRef
  workflow: PlanningWorkflow | null
  writable: boolean
  /** Moves when an agent changed; only the record is read again, not the chain. */
  agentsToken?: number
  /** The item's kind as the host's model has it, so its usage can be read with its record. */
  kind?: string
  /**
   * The address names this card's own chain, in this scope: the graph was opened from the
   * card's Relations, and the card opens there, its chain in that scope and in view.
   */
  ownChain?: ChainScope | null
  /** The parent, which the record names only by id; the host's model knows it. */
  parent?: Pick<WorkItemBrief, 'kind' | 'reference'> | null
  /** An address asked this card to go to its waiting question. */
  questionAsked?: boolean
  /** Where this card was left, when Back is what opened it again. */
  returnTo?: InspectorReturn | null
}>()

const emit = defineEmits<{
  'back': []
  'chain': [chain: WorkItemChain, branch: string | null]
  'changed': []
  'close': []
  /** A label pressed on the card, for the Work filter. */
  'filter': [token: WorkFilterToken]
  /** Another card opened from this one, and where this one was left. */
  'open': [reference: string, from: InspectorReturn]
  /** The address's order has reached this card and is spent, whatever it finds. */
  'question-taken': []
}>()

const { t } = useI18n()

const busy = ref(false)
const frame = ref<InstanceType<typeof DrawerFrame> | null>(null)
const facts = ref<InstanceType<typeof InspectorFacts> | null>(null)
const overview = ref<InstanceType<typeof InspectorOverview> | null>(null)
/** Whether a question on the card waits for its answer, and what they are; the discussion knows. */
const questionWaits = ref(false)
const questions = ref<readonly InputRequestEntry[]>([])
const { asking, discard, keep: keepEditing, leave, unsaved } = provideDraftGuard()
// A program this computer lacks is said once for the card, under its facts.
provideMissingPlaces()

const failureText = useFailureText()

const {
  item,
  load: loadResource,
  missing,
  pending,
  retryable: readRetryable,
  spent,
  state,
} = useInspectorRecord(props, (failure) => failureText(failure, 'workItem.loadFailed'))

const { offersExecution, section, sections, shownSection, tabs } = useInspectorSections(
  () => props.writable,
  () => frame.value?.scrollToContent(),
  () => props.projectId,
  () => (pending.value ? null : agentCount(item.value?.agents ?? [], spent.value)),
)

async function load() {
  writeError.value = ''
  await loadResource()
}

const holdFocus = () => frame.value?.holdFocus()

/** The Retry pressed goes with the failure it answers, and focus must not go with it. */
function retryRead() {
  holdFocus()
  void load()
}

async function reloaded() {
  await load()
  emit('changed')
}

const {
  attachMemory,
  claim,
  dismiss: dismissNotice,
  error: writeError,
  force,
  changeFacts,
  notice,
  release,
  takeOver,
  tick,
} = useInspectorWrites({
  busy,
  item,
  changed: reloaded,
  failureText: (error) => failureText(typedFailure(error, 'mutation_failed')),
  load,
  reference: () => props.reference,
  workflow: () => props.workflow,
  writable: () => props.writable,
})

// Read for an item the read found, again on every refresh, while the card offers it.
const { running, submitLaunch } = useInspectorExecution({
  busy,
  changed: reloaded,
  offered: () => offersExecution.value,
  readFor: () => (item.value ? `${item.value.work_item_id}:${props.refreshToken}` : ''),
  reference: () => props.reference,
})

// A string key, because a getter that returns a fresh array compares two new
// references every time and fires on any dependency touch rather than a change.
watch(
  [
    () =>
      `${props.projectId}:${props.resourceRef.resource_id}:${props.reference}:${props.refreshToken}`,
    () => props.writable,
  ],
  () => void load(),
  { immediate: true },
)

// Not `load`: news of an agent is no reason to take a refused write's reason away.
watch(
  () => props.agentsToken,
  () => void loadResource(),
)

// The chain is keyed by the item's own id, which only the loaded record carries,
// and re-read whenever the inspector itself refreshes: once per open, once per
// refresh, never twice for one answer. Like executions, the chain endpoint reads
// the primary store only, so an attached store's item asks it nothing.
const chainRoot = computed(() => (props.writable ? (item.value?.work_item_id ?? '') : ''))
const chain = useWorkItemChain(chainRoot, toRef(props, 'refreshToken'))

/** The item and its chain have both answered, so the body is as tall as it will be. */
const settled = () => item.value !== null && chain.answered.value

const chainSection = ref<InstanceType<typeof InspectorChain> | null>(null)

const { capture, holding } = useInspectorReturn({
  card: props,
  chain: chainSection,
  frame,
  read: () => item.value !== null,
  scope: chain.scope,
  section: shownSection,
  settled,
})

/** Open another card from this one, after the draft guard, saying where this one was left. */
const openFrom = (to: string) => void leave(() => emit('open', to, capture(to)))

const title = computed(() => item.value?.title || props.reference)
const target = computed(() => inspectorTarget(props))
const takeover = useTakeoverQuestion(() => item.value?.claim_ref ?? '', takeOver)

/** The band under the bar holds what has to be answered or read, and only while it does. */
const notices = computed(
  () => Boolean(notice.value || writeError.value || takeover.question.value) || asking.value,
)

/** The next step a guard asks for, taken where the inspector can take it. */
const onGuard = (guard: string) =>
  followGuard(guard, {
    claim,
    dismiss: dismissNotice,
    move: notice.value?.move,
    overview: overview.value,
    section,
  })

const { revealQuestion } = useQuestionReveal({
  asked: () => Boolean(props.questionAsked),
  overview,
  section,
  settled,
  taken: () => emit('question-taken'),
})

/**
 * Leave this item — close it, step back, or open another — after asking when
 * that would drop a draft. The question stands under the bar; the drawer stays
 * usable underneath it, and the draft stays until the answer is to discard it.
 * The guard asks the same question for a departure the inspector did not start.
 */
const close = () => void leave(() => emit('close'))

defineExpose({ close, openFrom })
</script>

<template>
  <DrawerFrame
    ref="frame"
    class="inspector-frame"
    :title="title"
    :action-anchor="facts?.actionCell"
    :close-label="t('drawer.close')"
    :headless="pending"
    :holding="holding"
    @close="close"
  >
    <template #title>
      <InspectorTitle :title="title" />
    </template>

    <template #controls>
      <InspectorControls
        :back="canGoBack"
        :menu="writable && !missing && !pending"
        :reference="reference"
        @back="void leave(() => emit('back'))"
      />
    </template>

    <template
      v-if="!missing && !pending"
      #identity
    >
      <InspectorIdentity
        :item="item"
        :reference="reference"
        :resource-ref="resourceRef"
      />
    </template>

    <template
      v-if="item && !missing && writable"
      #action
    >
      <InspectorWriteActions
        :item="item"
        :busy="busy"
        :reasons="false"
        @claim="claim"
        @release="release"
        @take-over="takeover.ask"
      />
    </template>

    <template
      v-if="item && !missing"
      #facts
    >
      <InspectorFacts
        ref="facts"
        :item="item"
        :workflow="workflow"
        :busy="busy"
        :writable="writable"
        :parent="parent"
        :asking="questionWaits"
        @question="revealQuestion"
        @claim="claim"
        @release="release"
        @take-over="takeover.ask"
        @fact="changeFacts"
        @filter="(token) => emit('filter', token)"
        @open="openFrom"
        @usage="section = 'agents'"
      />
    </template>

    <template
      v-if="notices"
      #notices
    >
      <InspectorNotices
        :asking="asking"
        :busy="busy"
        :error="writeError"
        :notice="notice"
        :takeover="takeover.question.value"
        :unsaved="unsaved"
        @discard="discard"
        @dismiss="dismissNotice"
        @force="force"
        @guard="onGuard"
        @keep="keepEditing"
        @keep-holder="takeover.keep"
        @take-over="takeover.confirm"
      />
    </template>

    <template
      v-if="!missing && !pending"
      #tabs
    >
      <InspectorTabs
        v-model="shownSection"
        :label="t('workItem.sections')"
        :sections="sections"
        :tabs="tabs"
      />
    </template>

    <InspectorReferenceScope
      :key="reference"
      :item="item"
      :space="resourceRef.resource_id"
      @open="openFrom"
    >
      <DataEmptyState
        v-if="missing"
        :title="t('platform.failures.notFound')"
      />
      <PlatformStatePanel
        v-else
        :state="state"
        :retryable="readRetryable"
        @retry="retryRead"
      >
        <template #default="{ payload }">
          <div
            v-if="state.status === 'degraded' && state.reason && readRetryable"
            class="inspector-read-recovery"
          >
            <VButton
              variant="ghost"
              @click="retryRead"
            >
              {{ t('platform.actions.retry') }}
            </VButton>
          </div>
          <TabPanel
            class="inspector-panel"
            :tabs="tabs"
            :value="section"
          >
            <InspectorOverview
              v-show="section === 'overview'"
              ref="overview"
              v-model:asking="questionWaits"
              v-model:questions="questions"
              :item="payload"
              :target="target"
              :writable="writable && !busy"
              @changed="reloaded"
              @hold-focus="holdFocus"
              @refresh="load"
              @resume="(state) => changeFacts({ state })"
              @tick="tick"
            />
            <InspectorRelations
              v-if="section === 'relations'"
              :item="payload"
              :writable="writable && !busy"
              @changed="reloaded"
              @open="openFrom"
            >
              <template #chain>
                <InspectorChain
                  ref="chainSection"
                  :chain="chain.chain.value"
                  :container="payload.container"
                  :failed="chain.failed.value"
                  :loading="chain.loading.value"
                  :readable="writable"
                  :scope="chain.scope.value"
                  @scope="chain.setScope"
                  @retry="chain.load"
                  @graph="(shown, branch) => emit('chain', shown, branch)"
                  @open="openFrom"
                />
              </template>
            </InspectorRelations>
            <InspectorAgents
              v-else-if="section === 'agents'"
              :agents="payload.agents ?? []"
            />
            <InspectorExecution
              v-else-if="section === 'execution'"
              :busy="busy"
              :error="running.error.value"
              :executions="running.executions.value"
              :identity="`${projectId}:${resourceRef.resource_id}:${reference}`"
              :loading="running.loading.value"
              :writable="writable"
              @launch="running.openLaunch"
              @stop="running.stop"
            />
            <InspectorMemory
              v-else-if="section === 'memory'"
              :item="payload"
              :project-id="projectId"
              :writable="writable && !busy"
              @attach="attachMemory"
            />
            <InspectorActivity
              v-else-if="section === 'activity'"
              :item="payload"
              :questions="questions"
            />
          </TabPanel>
        </template>
      </PlatformStatePanel>
    </InspectorReferenceScope>
  </DrawerFrame>

  <LaunchDialog
    v-if="offersExecution"
    :open="running.launchOpen.value"
    :busy="busy"
    :error="running.launchError.value"
    :capabilities="running.capabilities.value"
    :reference="reference"
    :repo="running.capabilities.value?.repository ?? ''"
    :title="title"
    @close="running.launchOpen.value = false"
    @submit="submitLaunch"
  />
</template>

<style scoped src="./WorkItemInspector.css"></style>
