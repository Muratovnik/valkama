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
 * bar, and both refuse rather than force: a guard that says no says which guard.
 */
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import InspectorActivity from '@/widgets/work-item-inspector/components/InspectorActivity.vue'
import InspectorExecution from '@/widgets/work-item-inspector/components/InspectorExecution.vue'
import InspectorMemory from '@/widgets/work-item-inspector/components/InspectorMemory.vue'
import InspectorOverview from '@/widgets/work-item-inspector/components/InspectorOverview.vue'
import InspectorRelations from '@/widgets/work-item-inspector/components/InspectorRelations.vue'
import InspectorUsage from '@/widgets/work-item-inspector/components/InspectorUsage.vue'
import KernelRelationsPanel from '@/widgets/work-item-inspector/components/KernelRelationsPanel.vue'
import { useWorkItemExecutions } from '@/widgets/work-item-inspector/utils/useWorkItemExecutions.ts'
import { useWorkItemResource } from '@/widgets/work-item-inspector/utils/useWorkItemResource.ts'

import LaunchDialog from '@/features/work-item-launch/LaunchDialog.vue'

import {
  attachWorkItemRef,
  claimWorkItem,
  commentWorkItem,
  linkWorkItems,
  setWorkItemSummary,
  tickChecklistStep,
  transitionWorkItem,
} from '@/shared/api/planningApi.ts'
import type { PlanningWorkflow } from '@/shared/api/planningModel.ts'
import type { PlatformRegistryReady } from '@/shared/api/platformApiTypes.ts'
import type { WorkItemRef } from '@/shared/api/platformPlanningRefs.ts'
import type { PlatformRelation } from '@/shared/api/platformRelations.ts'
import type { OperatingScope } from '@/shared/api/platformRoute.ts'
import { failureMessage, typedFailure } from '@/shared/api/typedFailure.ts'
import type { TypedFailure } from '@/shared/api/typedFailure.ts'
import { actorName } from '@/shared/lib/actor.ts'
import { INSPECTOR_DRAWER_STORAGE_KEY } from '@/shared/lib/shellLayout.ts'
import type { LaunchPacket } from '@/shared/types/launch.ts'
import type { PlanningSpaceEntityRef } from '@/shared/types/reference.ts'
import type { ChoiceOption } from '@/shared/ui/choiceControls.ts'
import ChoiceSelect from '@/shared/ui/ChoiceSelect.vue'
import DrawerFrame from '@/shared/ui/DrawerFrame.vue'
import PlatformStatePanel from '@/shared/ui/PlatformStatePanel.vue'
import ResizableInspector from '@/shared/ui/ResizableInspector.vue'
import SegmentedControl from '@/shared/ui/SegmentedControl.vue'
import VButton from '@/shared/ui/VButton.vue'
import VIcon from '@/shared/ui/VIcon.vue'

const props = defineProps<{
  /** True while a related item was opened from inside this drawer. */
  canGoBack: boolean
  /**
   * The Kernel half of the relations section: what this item points at outside
   * Valkama, and the authority to attach or open one. Absent in a global scope,
   * where no project answers for the item, and the section then shows only the
   * links between work items.
   */
  kernel: {
    invocationScope: OperatingScope
    registry: PlatformRegistryReady | null
    relations: readonly PlatformRelation[]
    viewScope: OperatingScope
    workItemRef: WorkItemRef
  } | null
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
  changed: []
  close: []
  open: [reference: string]
  session: [sessionId: string, clientFamily: string]
}>()

const { t } = useI18n()

type Section = 'activity' | 'execution' | 'memory' | 'overview' | 'relations' | 'usage'

const error = ref('')
const busy = ref(false)
const section = ref<Section>('overview')

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
} = useWorkItemResource(() => props.reference, readFailureReason)

async function load() {
  error.value = ''
  await loadResource()
}

const {
  capabilities,
  error: executionError,
  executions,
  launchError,
  launchOpen,
  load: loadExecutions,
  loading: executionsLoading,
  openLaunch,
  usage,
  usageError,
  usageLoading,
  start: startLaunch,
  stop: stopExecution,
} = useWorkItemExecutions(
  () => props.reference,
  busy,
  async () => {
    await load()
    emit('changed')
  },
)

/** The refusal is worded here, where the catalog is, not inside the composable. */
function submitLaunch(packet: LaunchPacket) {
  void startLaunch(packet, (message) => t('execution.launchFailed', { message }))
}

// A string key, because a getter that returns a fresh array compares two new
// references every time and fires on any dependency touch rather than a change.
watch(
  () => `${props.reference}:${props.refreshToken}`,
  () => {
    void load()
    void loadExecutions()
  },
  { immediate: true },
)

/**
 * One place where every write lands, so a refusal is reported the same way
 * whichever section made it and the record is always re-read afterwards. A
 * guard refusal is an answer, not a crash: it names the guard that refused.
 */
async function write(operation: () => Promise<unknown>) {
  if (!props.writable || busy.value) return
  busy.value = true
  error.value = ''
  try {
    await operation()
    await load()
    emit('changed')
  } catch (error_) {
    error.value = failureText(typedFailure(error_, 'mutation_failed'))
  } finally {
    busy.value = false
  }
}

const sections = computed<ChoiceOption[]>(() => [
  { value: 'overview' as const, label: t('workItem.overview') },
  { value: 'execution' as const, label: t('workItem.section.execution') },
  { value: 'usage' as const, label: t('workItem.section.usage') },
  { value: 'memory' as const, label: t('workItem.section.memory') },
  { value: 'relations' as const, label: t('workItem.relations') },
  { value: 'activity' as const, label: t('workItem.activity') },
])

/** The states this item may move to, which is the workflow's answer, not a list. */
const nextStates = computed<ChoiceOption[]>(() => {
  const record = item.value
  const workflow = props.workflow
  if (!record || !workflow) return []
  const allowed = new Set(
    workflow.transitions
      .filter((transition) => transition.from === record.state.state_id)
      .map((transition) => transition.to),
  )
  return workflow.states
    .filter((state) => allowed.has(state.state_id))
    .map((state) => ({ value: state.key, label: state.name }))
})

const title = computed(() => item.value?.title || props.reference)
const holder = computed(() => (item.value?.claim_ref ? actorName(item.value.claim_ref) : ''))

const stateChoice = computed({
  get: () => '',
  set: (value: string) => {
    if (value) moveTo(value)
  },
})

const shownSection = computed({
  get: () => section.value,
  set: (value: string) => {
    section.value = value as Section
  },
})

function claim() {
  void write(() => claimWorkItem({ id: props.reference }))
}

function release() {
  void write(() => claimWorkItem({ id: props.reference, release: true }))
}

function moveTo(stateKey: string) {
  if (!stateKey) return
  void write(() => transitionWorkItem({ id: props.reference, state: stateKey }))
}

function saveSummary(summary: { done: string; next: string; why: string }) {
  void write(() => setWorkItemSummary({ id: props.reference, summary }))
}

function tick(itemId: string, done: boolean) {
  void write(() => tickChecklistStep({ id: props.reference, item_id: itemId, done }))
}

/**
 * A pointer, not a copy. Valkama records that this item names the document; the
 * provider is not asked to store anything, which is why a read-only knowledge
 * source can still be attached to a work item.
 */
function attachMemory(entry: { label: string; value: string }) {
  void write(() =>
    attachWorkItemRef({
      id: props.reference,
      kind: 'memory',
      value: entry.value,
      label: entry.label,
    }),
  )
}

function comment(body: string) {
  void write(() => commentWorkItem({ id: props.reference, body }))
}

function link(value: { kind: string; other: string }) {
  void write(() => linkWorkItems({ id: props.reference, ...value }))
}

function unlink(value: { kind: string; other: string }) {
  void write(() => linkWorkItems({ id: props.reference, ...value, remove: true }))
}
</script>

<template>
  <ResizableInspector
    class="drawer"
    :open="true"
    :label="t('workItem.resize')"
    :storage-key="INSPECTOR_DRAWER_STORAGE_KEY"
    @close="emit('close')"
  >
    <DrawerFrame
      class="inspector-frame"
      :title="title"
      :close-label="t('drawer.close')"
      @close="emit('close')"
    >
      <template #meta>
        <div class="inspector-meta">
          <button
            v-if="canGoBack"
            class="head-back"
            type="button"
            :title="t('workItem.back')"
            @click="emit('back')"
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
            >{{ holder }}</span
          >
        </div>
      </template>

      <template
        v-if="item && writable"
        #actions
      >
        <div class="head-actions">
          <VButton
            v-if="item.claim_ref"
            :disabled="busy"
            @click="release"
          >
            {{ t('workItem.release') }}
          </VButton>
          <VButton
            v-else
            variant="primary"
            :disabled="busy"
            @click="claim"
          >
            {{ t('workItem.claim') }}
          </VButton>
          <ChoiceSelect
            v-model="stateChoice"
            class="state-choice"
            :label="t('workItem.moveTo')"
            :placeholder="t('workItem.moveTo')"
            :options="nextStates"
            :disabled="busy || !nextStates.length"
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
        <p
          v-if="error"
          class="inspector-write-error"
          role="alert"
        >
          {{ error }}
        </p>
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
              v-if="section === 'overview'"
              :item="payload"
              :resource-ref="resourceRef"
              :writable="writable && !busy"
              @summary="saveSummary"
              @tick="tick"
            />
            <template v-else-if="section === 'relations'">
              <InspectorRelations
                :item="payload"
                :writable="writable && !busy"
                @link="link"
                @unlink="unlink"
                @open="(target) => emit('open', target)"
              />
              <KernelRelationsPanel
                v-if="props.kernel"
                :work-item-ref="props.kernel.workItemRef"
                :invocation-scope="props.kernel.invocationScope"
                :view-scope="props.kernel.viewScope"
                :registry="props.kernel.registry"
                :relations="props.kernel.relations"
                :revision="payload.revision"
                @changed="() => emit('changed')"
              />
            </template>
            <InspectorExecution
              v-else-if="section === 'execution'"
              :busy="busy"
              :error="executionError"
              :executions="executions"
              :loading="executionsLoading"
              :writable="writable"
              @launch="openLaunch"
              @stop="stopExecution"
              @session="(id, family) => emit('session', id, family)"
            />
            <InspectorUsage
              v-else-if="section === 'usage'"
              :error="usageError"
              :loading="usageLoading"
              :usage="usage"
            />
            <InspectorMemory
              v-else-if="section === 'memory'"
              :item="payload"
              :project-id="projectId"
              :writable="writable && !busy"
              @attach="attachMemory"
            />
            <InspectorActivity
              v-else
              :item="payload"
              :writable="writable && !busy"
              @comment="comment"
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
