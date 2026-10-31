<script setup lang="ts">
/**
 * One work item, opened by its reference.
 *
 * The sections are Valkama's, not an adapter's: an adapter supplies records, and
 * never markup for a panel. Three are live at this layer and five are declared
 * empty inside Overview, which is what keeps the shell honest while later layers
 * are still being built.
 *
 * The head carries the two writes that change what the item *is* — who holds it
 * and what state it is in — because both are answered by looking at the title
 * bar. Both refuse rather than force: a refusal shows the server's reason in the
 * head, beside the action that would satisfy it, and overriding is a second,
 * explicit answer rather than a default.
 */
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import InspectorActivity from '@/widgets/work-item-inspector/components/InspectorActivity.vue'
import InspectorChain from '@/widgets/work-item-inspector/components/InspectorChain.vue'
import InspectorExecution from '@/widgets/work-item-inspector/components/InspectorExecution.vue'
import InspectorMemory from '@/widgets/work-item-inspector/components/InspectorMemory.vue'
import InspectorOverview from '@/widgets/work-item-inspector/components/InspectorOverview.vue'
import InspectorRelations from '@/widgets/work-item-inspector/components/InspectorRelations.vue'
import InspectorWriteActions from '@/widgets/work-item-inspector/components/InspectorWriteActions.vue'
import { provideDraftGuard } from '@/widgets/work-item-inspector/utils/useDraftGuard.ts'
import { useInspectorWrites } from '@/widgets/work-item-inspector/utils/useInspectorWrites.ts'
import { useWorkItemChain } from '@/widgets/work-item-inspector/utils/useWorkItemChain.ts'
import { useWorkItemExecutions } from '@/widgets/work-item-inspector/utils/useWorkItemExecutions.ts'
import { useWorkItemResource } from '@/widgets/work-item-inspector/utils/useWorkItemResource.ts'

import LaunchDialog from '@/features/work-item-launch/LaunchDialog.vue'

import type { WorkItemChain } from '@/shared/api/planningChainApi.ts'
import type { PlanningWorkflow } from '@/shared/api/planningModel.ts'
import type { PlanningTarget } from '@/shared/api/planningTarget.ts'
import { planningSpaceRef } from '@/shared/api/platformPlanningRefs.ts'
import { failureMessage, typedFailure } from '@/shared/api/typedFailure.ts'
import type { TypedFailure } from '@/shared/api/typedFailure.ts'
import { actorName } from '@/shared/lib/actor.ts'
import { INSPECTOR_DRAWER_STORAGE_KEY } from '@/shared/lib/shellLayout.ts'
import type { LaunchPacket } from '@/shared/types/launch.ts'
import type { PlanningSpaceEntityRef } from '@/shared/types/reference.ts'
import type { ChoiceOption } from '@/shared/ui/choiceControls.ts'
import ConfirmStrip from '@/shared/ui/ConfirmStrip.vue'
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
}>()

const emit = defineEmits<{
  back: []
  chain: [chain: WorkItemChain]
  changed: []
  close: []
  open: [reference: string]
  session: [sessionId: string, clientFamily: string]
}>()

const { t } = useI18n()

type Section = 'activity' | 'execution' | 'memory' | 'overview' | 'relations'

const busy = ref(false)
const section = ref<Section>('overview')
const frame = ref<InstanceType<typeof DrawerFrame> | null>(null)
const overview = ref<InstanceType<typeof InspectorOverview> | null>(null)
const { asking, discard, keep: keepEditing, leave, unsaved } = provideDraftGuard()

function failureText(failure: TypedFailure, fallbackKey?: string): string {
  const message = failureMessage(failure)
  return message.key === 'platform.failures.unknown' && fallbackKey !== undefined
    ? t(fallbackKey)
    : t(message.key, message.params ?? {})
}

function readFailureReason(failure: TypedFailure): string {
  return failureText(failure, 'workItem.loadFailed')
}

const {
  item,
  load: loadResource,
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
  load: loadExecutions,
  loading: executionsLoading,
  openLaunch,
  start: startLaunch,
  stop: stopExecution,
} = useWorkItemExecutions(() => props.reference, busy, reloaded)

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
    // Execution endpoints name primary-store items by reference only.
    if (props.writable) void loadExecutions()
    else if (section.value === 'execution') section.value = 'overview'
  },
  { immediate: true },
)

// The chain is keyed by the item's own id, which only the loaded record carries,
// and re-read whenever the inspector itself refreshes: once per open, once per
// refresh, never twice for one answer. Like executions, the chain endpoint reads
// the primary store only, so an attached store's item asks it nothing.
const chain = useWorkItemChain()
const chainRoot = computed(() => (props.writable ? (item.value?.work_item_id ?? '') : ''))
watch(
  () => `${chainRoot.value}:${props.refreshToken}`,
  () => void chain.load(chainRoot.value),
  { immediate: true },
)
const retryChain = () => void chain.load()

// Every tab starts at its own top. The body is one scroller, so a tab opened
// after reading far down another used to open at that same depth.
watch(section, () => frame.value?.scrollToTop())

const sections = computed<ChoiceOption[]>(() => [
  { value: 'overview' as const, label: t('workItem.overview') },
  ...(props.writable
    ? [{ value: 'execution' as const, label: t('workItem.section.execution') }]
    : []),
  { value: 'memory' as const, label: t('workItem.section.memory') },
  { value: 'relations' as const, label: t('workItem.relations') },
  { value: 'activity' as const, label: t('workItem.activity') },
])

const title = computed(() => item.value?.title || props.reference)
const target = computed<PlanningTarget | undefined>(() => {
  const space = planningSpaceRef(props.resourceRef)
  return props.projectId && space
    ? {
        project_id: props.projectId,
        space_ref: space,
        reference: props.reference,
        writable: props.writable,
      }
    : undefined
})
const holder = computed(() => (item.value?.claim_ref ? actorName(item.value.claim_ref) : ''))
const holderLabel = computed(() =>
  t(item.value?.state.is_terminal ? 'workItem.previousHolder' : 'workItem.holder', {
    holder: holder.value,
  }),
)

const headSlot = computed(() => Boolean(item.value && props.writable) || asking.value)

const shownSection = computed({
  get: () => section.value,
  set: (value: string) => {
    section.value = value as Section
  },
})

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

const discardQuestion = computed(() =>
  t('workItem.discard.question', {
    drafts: unsaved.value.map((kind) => t(`workItem.discard.${kind}`)).join(', '),
  }),
)

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
      <template #meta>
        <div class="inspector-meta">
          <button
            v-if="canGoBack"
            class="head-back"
            type="button"
            :title="t('workItem.back')"
            @click="void leave(() => emit('back'))"
          >
            <VIcon
              name="chevron-left"
              :size="16"
            />
            <span>{{ t('workItem.back') }}</span>
          </button>
          <span class="head-reference">{{ reference }}</span>
          <span
            v-if="holder"
            class="head-claim"
            >{{ holderLabel }}</span
          >
        </div>
      </template>

      <template
        v-if="headSlot"
        #actions
      >
        <div class="head-stack">
          <InspectorWriteActions
            v-if="item && writable"
            :item="item"
            :workflow="workflow"
            :busy="busy"
            :notice="notice"
            :error="writeError"
            @claim="claim"
            @release="release"
            @take-over="takeOver"
            @move="moveTo"
            @dismiss="dismissNotice"
            @force="force"
            @guard="followGuard"
          />
          <ConfirmStrip
            v-if="asking"
            tone="danger"
            :message="discardQuestion"
            :confirm-label="t('workItem.discard.confirm')"
            :cancel-label="t('workItem.discard.keep')"
            @confirm="discard"
            @cancel="keepEditing"
          />
        </div>
      </template>

      <template #tabs>
        <div class="inspector-tabs">
          <SegmentedControl
            v-model="shownSection"
            size="compact"
            :label="t('workItem.sections')"
            :options="sections"
          />
        </div>
      </template>

      <article
        :key="reference"
        class="inspector"
      >
        <PlatformStatePanel
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
                  :chain="chain.chain.value"
                  :container="payload.container"
                  :failed="chain.failed.value"
                  :loading="chain.loading.value"
                  :readable="writable"
                  :scope="chain.scope.value"
                  @scope="chain.setScope"
                  @retry="retryChain"
                  @graph="(shown) => emit('chain', shown)"
                  @open="(target) => void leave(() => emit('open', target))"
                />
              </template>
            </InspectorOverview>
            <InspectorRelations
              v-if="section === 'relations'"
              :item="payload"
              :writable="writable && !busy"
              @changed="reloaded"
              @session="(id, family) => emit('session', id, family)"
              @open="(target) => void leave(() => emit('open', target))"
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
      </article>
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
