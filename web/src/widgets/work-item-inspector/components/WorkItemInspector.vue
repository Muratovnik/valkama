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
 * facts under that — the state as the menu that moves it, the priority, the holder,
 * the epic — with the one action at their end, the labels, and the sections. It used
 * to put a full-width write row and a section before the facts, which started half
 * way down the drawer. The writes refuse rather than force: a refusal shows the
 * server's reason in the band under the bar, where it is seen however far down the
 * write was made, and overriding is a second, explicit answer rather than a default.
 *
 * A reference the service says names nothing is not a failure: there is nothing
 * to retry and no section to open. The card says so once, under a title that
 * already is the reference, with no identity line, no facts, no tabs and no
 * writes, and Close is the way on.
 */
import { computed, ref, toRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import InspectorActivity from '@/widgets/work-item-inspector/components/InspectorActivity.vue'
import InspectorChain from '@/widgets/work-item-inspector/components/InspectorChain.vue'
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
import type { InspectorReturn } from '@/widgets/work-item-inspector/utils/inspectorReturn.ts'
import { inspectorTarget } from '@/widgets/work-item-inspector/utils/inspectorTarget.ts'
import { provideDraftGuard } from '@/widgets/work-item-inspector/utils/useDraftGuard.ts'
import { useInspectorReturn } from '@/widgets/work-item-inspector/utils/useInspectorReturn.ts'
import { useInspectorSections } from '@/widgets/work-item-inspector/utils/useInspectorSections.ts'
import { useInspectorWrites } from '@/widgets/work-item-inspector/utils/useInspectorWrites.ts'
import { useTakeoverQuestion } from '@/widgets/work-item-inspector/utils/useTakeoverQuestion.ts'
import { useWorkItemChain } from '@/widgets/work-item-inspector/utils/useWorkItemChain.ts'
import { useWorkItemExecutions } from '@/widgets/work-item-inspector/utils/useWorkItemExecutions.ts'
import { useWorkItemResource } from '@/widgets/work-item-inspector/utils/useWorkItemResource.ts'

import LaunchDialog from '@/features/work-item-launch/LaunchDialog.vue'

import type { WorkFilterToken } from '@/entities/work-item/utils/workFilter.ts'

import type { WorkItemChain } from '@/shared/api/planningChainApi.ts'
import type { PlanningWorkflow } from '@/shared/api/planningModel.ts'
import { failureMessage, typedFailure } from '@/shared/api/typedFailure.ts'
import type { TypedFailure } from '@/shared/api/typedFailure.ts'
import type { LaunchPacket } from '@/shared/types/launch.ts'
import type { PlanningSpaceEntityRef } from '@/shared/types/reference.ts'
import DataEmptyState from '@/shared/ui/DataEmptyState.vue'
import DrawerFrame from '@/shared/ui/DrawerFrame.vue'
import PlatformStatePanel from '@/shared/ui/PlatformStatePanel.vue'
import VButton from '@/shared/ui/VButton.vue'
import VIcon from '@/shared/ui/VIcon.vue'

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
  /** The epic's reference, which the record names only by id; the host's model knows it. */
  parentReference?: string | null
  /** Where this card was left, when Back is what opened it again. */
  returnTo?: InspectorReturn | null
}>()

const emit = defineEmits<{
  back: []
  chain: [chain: WorkItemChain, branch: string | null]
  changed: []
  close: []
  /** A label pressed on the card, for the Work filter. */
  filter: [token: WorkFilterToken]
  /** Another card opened from this one, and where this one was left. */
  open: [reference: string, from: InspectorReturn]
  session: [sessionId: string, clientFamily: string]
}>()

const { t } = useI18n()

const busy = ref(false)
const frame = ref<InstanceType<typeof DrawerFrame> | null>(null)
const facts = ref<InstanceType<typeof InspectorFacts> | null>(null)
const { leaveUnreadable, section, sections, shownSection } = useInspectorSections(
  () => props.writable,
  () => frame.value?.scrollToContent(),
)
const overview = ref<InstanceType<typeof InspectorOverview> | null>(null)
const { asking, discard, keep: keepEditing, leave, unsaved } = provideDraftGuard()

function failureText(failure: TypedFailure, fallbackKey?: string): string {
  const message = failureMessage(failure)
  return message.key === 'platform.failures.unknown' && fallbackKey !== undefined
    ? t(fallbackKey)
    : t(message.key, message.params ?? {})
}

const {
  item,
  load: loadResource,
  missing,
  retryable: readRetryable,
  state,
} = useWorkItemResource(
  () => props.reference,
  () => ({ project: props.projectId, resource: props.resourceRef }),
  (failure) => failureText(failure, 'workItem.loadFailed'),
)

async function load() {
  writeError.value = ''
  await loadResource()
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
  moveTo,
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
  stateName: (key) => props.workflow?.states.find((entry) => entry.key === key)?.name ?? key,
  writable: () => props.writable,
})

const {
  capabilities,
  error: executionError,
  executions,
  launchError,
  launchOpen,
  loading: executionsLoading,
  openLaunch,
  start: startLaunch,
  stop: stopExecution,
  // Read for an item the read found, again on every refresh. Execution endpoints
  // name primary-store items by reference only, so an attached one asks nothing.
} = useWorkItemExecutions(
  () => props.reference,
  busy,
  reloaded,
  () => (props.writable && item.value ? `${item.value.work_item_id}:${props.refreshToken}` : ''),
)

/** The refusal is worded here, where the catalog is, not inside the composable. */
function submitLaunch(packet: LaunchPacket) {
  if (!props.writable) return
  void startLaunch(packet, (message) => t('execution.launchFailed', { message }))
}

// A string key, because a getter that returns a fresh array compares two new
// references every time and fires on any dependency touch rather than a change.
watch(
  [
    () =>
      `${props.projectId}:${props.resourceRef.resource_id}:${props.reference}:${props.refreshToken}`,
    () => props.writable,
  ],
  () => {
    void load()
    leaveUnreadable()
  },
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

const chainSection = ref<InstanceType<typeof InspectorChain> | null>(null)
const { capture } = useInspectorReturn({
  chain: chainSection,
  frame,
  returnTo: props.returnTo ?? null,
  reference: () => props.reference,
  scope: chain.scope,
  section: shownSection,
  settled: () =>
    item.value !== null &&
    !chain.loading.value &&
    (chainRoot.value === '' || chain.chain.value !== null || chain.failed.value),
})

/** Open another card from this one, after the draft guard, saying where this one was left. */
const openFrom = (to: string) => void leave(() => emit('open', to, capture(to)))

const title = computed(() => item.value?.title || props.reference)
const target = computed(() => inspectorTarget(props))
const {
  ask: askTakeover,
  confirm: confirmTakeover,
  keep: keepHolder,
  question: takeoverQuestion,
} = useTakeoverQuestion(() => item.value?.claim_ref ?? '', takeOver)

/** The band under the bar holds what has to be answered or read, and only while it does. */
const notices = computed(
  () => Boolean(notice.value || writeError.value || takeoverQuestion.value) || asking.value,
)

/** The next step a guard asks for, taken where the inspector can take it. */
function followGuard(guard: string) {
  if (guard === 'executor') {
    claim()
    return
  }
  const move = notice.value?.move
  dismissNotice()
  if (guard === 'blocker') {
    section.value = 'relations'
    return
  }
  section.value = 'overview'
  if (guard === 'summary' && move) void overview.value?.askOutcome(move)
  else if (guard === 'checklist') overview.value?.revealChecklist()
}

/**
 * Leave this item — close it, step back, or open another — after asking when
 * that would drop a draft. The question stands under the bar; the drawer stays
 * usable underneath it, and the draft stays until the answer is to discard it.
 * The guard asks the same question for a departure the inspector did not start.
 */
const close = () => void leave(() => emit('close'))

defineExpose({ close })
</script>

<template>
  <DrawerFrame
    ref="frame"
    class="inspector-frame"
    :title="title"
    :action-anchor="facts?.actionCell"
    :close-label="t('drawer.close')"
    @close="close"
  >
    <template #title>
      <InspectorTitle :title="title" />
    </template>

    <template #controls>
      <VButton
        v-if="canGoBack"
        class="head-back"
        size="compact"
        variant="ghost"
        :aria-label="t('workItem.back')"
        @click="void leave(() => emit('back'))"
      >
        <VIcon
          name="chevron-left"
          :size="16"
        />
        <span class="head-back-word">{{ t('workItem.back') }}</span>
      </VButton>
    </template>

    <template
      v-if="!missing"
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
        @take-over="askTakeover"
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
        :parent-reference="parentReference"
        @claim="claim"
        @release="release"
        @take-over="askTakeover"
        @move="moveTo"
        @filter="(token) => emit('filter', token)"
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
        :takeover="takeoverQuestion"
        :unsaved="unsaved"
        @discard="discard"
        @dismiss="dismissNotice"
        @force="force"
        @guard="followGuard"
        @keep="keepEditing"
        @keep-holder="keepHolder"
        @take-over="confirmTakeover"
      />
    </template>

    <template
      v-if="!missing"
      #tabs
    >
      <InspectorTabs
        v-model="shownSection"
        :label="t('workItem.sections')"
        :sections="sections"
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
        @retry="load"
      >
        <template #default="{ payload }">
          <div
            v-if="state.status === 'degraded' && state.reason && readRetryable"
            class="inspector-read-recovery"
          >
            <VButton
              variant="ghost"
              @click="load"
            >
              {{ t('platform.actions.retry') }}
            </VButton>
          </div>
          <InspectorOverview
            v-show="section === 'overview'"
            ref="overview"
            :item="payload"
            :target="target"
            :writable="writable && !busy"
            @changed="reloaded"
            @refresh="load"
            @resume="moveTo"
            @tick="tick"
          >
            <template #composition>
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
          </InspectorOverview>
          <InspectorRelations
            v-if="section === 'relations'"
            :item="payload"
            :resource-ref="resourceRef"
            :writable="writable && !busy"
            @changed="reloaded"
            @session="(id, family) => emit('session', id, family)"
            @open="openFrom"
          />
          <InspectorExecution
            v-else-if="section === 'execution'"
            :busy="busy"
            :error="executionError"
            :executions="executions"
            :identity="`${projectId}:${resourceRef.resource_id}:${reference}`"
            :loading="executionsLoading"
            :writable="writable"
            @launch="openLaunch"
            @stop="stopExecution"
            @session="(id, family) => emit('session', id, family)"
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
          />
        </template>
      </PlatformStatePanel>
    </InspectorReferenceScope>
  </DrawerFrame>

  <LaunchDialog
    :open="launchOpen"
    :busy="busy"
    :error="launchError"
    :capabilities="capabilities"
    :reference="reference"
    :repo="capabilities?.repository ?? ''"
    :title="title"
    @close="launchOpen = false"
    @submit="submitLaunch"
  />
</template>

<style scoped src="./WorkItemInspector.css"></style>
