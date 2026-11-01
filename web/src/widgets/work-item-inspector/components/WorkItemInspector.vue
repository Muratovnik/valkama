<script setup lang="ts">
/**
 * One work item, opened by its reference.
 *
 * The sections are Valkama's, not an adapter's: an adapter supplies records, and
 * never markup for a panel. Three are live at this layer and five are declared
 * empty inside Overview, which is what keeps the shell honest while later layers
 * are still being built.
 *
 * The head that stays in view is the item's name, its reference and the
 * sections, and the reference steps out once the body is read past the head:
 * with the two writes and the holder pinned too it took a quarter of a desktop
 * drawer and a third of a phone's. The two writes
 * that change what the item *is* — who holds it and what state it is in — open
 * the body instead, above every section. Both refuse rather than force: a
 * refusal shows the server's reason in the head, where it is seen however far
 * down the write was made, and overriding is a second, explicit answer rather
 * than a default. Who holds the item is said once, beside its claim in the
 * overview, not again in the head.
 *
 * A reference the service says names nothing is not a failure: there is nothing
 * to retry and no section to open. The card says so once, under a title that
 * already is the reference, with no reference line, no tabs and no writes, and
 * Close is the way on.
 */
import { computed, ref, toRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import InspectorActivity from '@/widgets/work-item-inspector/components/InspectorActivity.vue'
import InspectorChain from '@/widgets/work-item-inspector/components/InspectorChain.vue'
import InspectorExecution from '@/widgets/work-item-inspector/components/InspectorExecution.vue'
import InspectorMemory from '@/widgets/work-item-inspector/components/InspectorMemory.vue'
import InspectorNotices from '@/widgets/work-item-inspector/components/InspectorNotices.vue'
import InspectorOverview from '@/widgets/work-item-inspector/components/InspectorOverview.vue'
import InspectorReferenceScope from '@/widgets/work-item-inspector/components/InspectorReferenceScope.vue'
import InspectorRelations from '@/widgets/work-item-inspector/components/InspectorRelations.vue'
import InspectorWriteActions from '@/widgets/work-item-inspector/components/InspectorWriteActions.vue'
import type { InspectorReturn } from '@/widgets/work-item-inspector/utils/inspectorReturn.ts'
import { inspectorTarget } from '@/widgets/work-item-inspector/utils/inspectorTarget.ts'
import { titleRuns } from '@/widgets/work-item-inspector/utils/titleRuns.ts'
import { provideDraftGuard } from '@/widgets/work-item-inspector/utils/useDraftGuard.ts'
import { useInspectorReturn } from '@/widgets/work-item-inspector/utils/useInspectorReturn.ts'
import { useInspectorSections } from '@/widgets/work-item-inspector/utils/useInspectorSections.ts'
import { useInspectorWrites } from '@/widgets/work-item-inspector/utils/useInspectorWrites.ts'
import { useWorkItemChain } from '@/widgets/work-item-inspector/utils/useWorkItemChain.ts'
import { useWorkItemExecutions } from '@/widgets/work-item-inspector/utils/useWorkItemExecutions.ts'
import { useWorkItemResource } from '@/widgets/work-item-inspector/utils/useWorkItemResource.ts'

import LaunchDialog from '@/features/work-item-launch/LaunchDialog.vue'

import type { WorkItemChain } from '@/shared/api/planningChainApi.ts'
import type { PlanningWorkflow } from '@/shared/api/planningModel.ts'
import { failureMessage, typedFailure } from '@/shared/api/typedFailure.ts'
import type { TypedFailure } from '@/shared/api/typedFailure.ts'
import { INSPECTOR_DRAWER_STORAGE_KEY } from '@/shared/lib/shellLayout.ts'
import type { LaunchPacket } from '@/shared/types/launch.ts'
import type { PlanningSpaceEntityRef } from '@/shared/types/reference.ts'
import DataEmptyState from '@/shared/ui/DataEmptyState.vue'
import DrawerFrame from '@/shared/ui/DrawerFrame.vue'
import PlatformStatePanel from '@/shared/ui/PlatformStatePanel.vue'
import ResizableInspector from '@/shared/ui/ResizableInspector.vue'
import SegmentedControl from '@/shared/ui/SegmentedControl.vue'
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
  /** Where this card was left, when Back is what opened it again. */
  returnTo?: InspectorReturn | null
}>()

const emit = defineEmits<{
  back: []
  chain: [chain: WorkItemChain, branch: string | null]
  changed: []
  close: []
  /** Another card opened from this one, and where this one was left. */
  open: [reference: string, from: InspectorReturn]
  session: [sessionId: string, clientFamily: string]
}>()

const { t } = useI18n()

const busy = ref(false)
const frame = ref<InstanceType<typeof DrawerFrame> | null>(null)
const { leaveUnreadable, section, sections, shownSection } = useInspectorSections(
  () => props.writable,
  () => frame.value?.scrollToTop(),
)
const overview = ref<InstanceType<typeof InspectorOverview> | null>(null)
const { asking, discard, keep: keepEditing, leave, unsaved } = provideDraftGuard()

function failureText(failure: TypedFailure, fallbackKey?: string): string {
  const message = failureMessage(failure)
  return message.key === 'platform.failures.unknown' && fallbackKey !== undefined
    ? t(fallbackKey)
    : t(message.key, message.params ?? {})
}

const readFailureReason = (failure: TypedFailure) => failureText(failure, 'workItem.loadFailed')

const {
  item,
  load: loadResource,
  missing,
  retryable: readRetryable,
  state,
} = useWorkItemResource(
  () => props.reference,
  () => ({ project: props.projectId, resource: props.resourceRef }),
  readFailureReason,
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

// The chain is keyed by the item's own id, which only the loaded record carries,
// and re-read whenever the inspector itself refreshes: once per open, once per
// refresh, never twice for one answer. Like executions, the chain endpoint reads
// the primary store only, so an attached store's item asks it nothing.
const chainRoot = computed(() => (props.writable ? (item.value?.work_item_id ?? '') : ''))
const chain = useWorkItemChain(chainRoot, toRef(props, 'refreshToken'))
const retryChain = () => void chain.load()

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
const titleText = computed(() => titleRuns(title.value))
const target = computed(() => inspectorTarget(props))
/** The head holds what has to be answered or read before going on, and only while it does. */
const headSlot = computed(() => Boolean(notice.value || writeError.value) || asking.value)

/** The next step a guard asks for, taken where the inspector can take it. */
function followGuard(guard: string) {
  if (guard === 'executor') {
    claim()
    return
  }
  dismissNotice()
  if (guard === 'blocker') {
    section.value = 'relations'
    return
  }
  section.value = 'overview'
  if (guard === 'summary') void overview.value?.startOutcomeReport()
  else if (guard === 'checklist') overview.value?.revealChecklist()
}

/**
 * Leave this item — close it, step back, or open another — after asking when
 * that would drop a draft. The question stands in the head; the drawer stays
 * usable underneath it, and the draft stays until the answer is to discard it.
 * The guard asks the same question for a departure the inspector did not start.
 */
const close = () => void leave(() => emit('close'))
</script>

<template>
  <ResizableInspector
    surface-class="drawer"
    :open="true"
    :label="title"
    :resize-label="t('workItem.resize')"
    :storage-key="INSPECTOR_DRAWER_STORAGE_KEY"
    @close="close"
  >
    <DrawerFrame
      ref="frame"
      class="inspector-frame"
      :title="title"
      :close-label="t('drawer.close')"
      @close="close"
    >
      <template #title>
        <template
          v-for="(run, index) in titleText"
          :key="index"
        >
          <span
            v-if="run.whole"
            class="head-title-reference"
            >{{ run.text }}</span
          ><template v-else>{{ run.text }}</template>
        </template>
      </template>

      <template #controls>
        <VButton
          v-if="canGoBack"
          class="head-back"
          variant="ghost"
          @click="void leave(() => emit('back'))"
        >
          <VIcon
            name="chevron-left"
            :size="16"
          />
          {{ t('workItem.back') }}
        </VButton>
      </template>

      <template
        v-if="!missing"
        #meta
      >
        <div class="inspector-meta">
          <span class="head-reference">{{ reference }}</span>
        </div>
      </template>

      <template
        v-if="headSlot"
        #actions
      >
        <InspectorNotices
          :asking="asking"
          :busy="busy"
          :error="writeError"
          :notice="notice"
          :unsaved="unsaved"
          @discard="discard"
          @dismiss="dismissNotice"
          @force="force"
          @guard="followGuard"
          @keep="keepEditing"
        />
      </template>

      <template
        v-if="!missing"
        #tabs
      >
        <div class="inspector-tabs">
          <SegmentedControl
            v-model="shownSection"
            size="compact"
            :label="t('workItem.sections')"
            :options="sections"
            wrap
          />
        </div>
      </template>

      <div
        v-if="item && writable"
        class="inspector-writes"
      >
        <InspectorWriteActions
          :item="item"
          :workflow="workflow"
          :busy="busy"
          @claim="claim"
          @release="release"
          @take-over="takeOver"
          @move="moveTo"
        />
      </div>
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
              :resource-ref="resourceRef"
              :target="target"
              :writable="writable && !busy"
              @changed="reloaded"
              @refresh="load"
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
                  @retry="retryChain"
                  @graph="(shown, branch) => emit('chain', shown, branch)"
                  @open="openFrom"
                />
              </template>
            </InspectorOverview>
            <InspectorRelations
              v-if="section === 'relations'"
              :item="payload"
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
  </ResizableInspector>

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
