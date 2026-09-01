<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import RelationConfirm from '@/widgets/work-item-inspector/components/RelationConfirm.vue'
import RelationList from '@/widgets/work-item-inspector/components/RelationList.vue'
import { attachCandidates } from '@/widgets/work-item-inspector/utils/attachRoutes.ts'
import type { CandidateNaming } from '@/widgets/work-item-inspector/utils/attachRoutes.ts'

import type { ActionRef } from '@/shared/api/platformActionRef.ts'
import { invokePlatformAction, mutatePlatformRelation } from '@/shared/api/platformApi.ts'
import {
  ACTION_COMMAND_INTERFACE,
  RELATION_COMMAND_INTERFACE,
} from '@/shared/api/platformApiTypes.ts'
import type { ActionInputDescriptor, PlatformRegistryReady } from '@/shared/api/platformApiTypes.ts'
import { isAdapterResourceRef } from '@/shared/api/platformEntityRef.ts'
import type { AdapterResourceRef } from '@/shared/api/platformEntityRef.ts'
import { planningWorkItemEntity } from '@/shared/api/platformPlanningRefs.ts'
import type { WorkItemRef } from '@/shared/api/platformPlanningRefs.ts'
import type { PlatformRelation } from '@/shared/api/platformRelations.ts'
import type { OperatingScope } from '@/shared/api/platformRoute.ts'
import type { ChoiceOption } from '@/shared/ui/choiceControls.ts'
import SectionHeading from '@/shared/ui/SectionHeading.vue'
import SelectionControl from '@/shared/ui/SelectionControl.vue'
import VButton from '@/shared/ui/VButton.vue'
import VIcon from '@/shared/ui/VIcon.vue'
import VTextInput from '@/shared/ui/VTextInput.vue'

const props = defineProps<{
  invocationScope: OperatingScope
  registry: PlatformRegistryReady | null
  relations: readonly PlatformRelation[]
  revision: number
  viewScope: OperatingScope
  workItemRef: WorkItemRef
}>()

const emit = defineEmits<{ changed: [revision: number] }>()
const { t, te } = useI18n()

const attachOpen = ref(false)
const selectedCandidate = ref('')
const externalId = ref('')
const confirmed = ref(false)
const pendingOpen = ref<{ action: ActionRef; resource: AdapterResourceRef } | null>(null)
const openConfirmed = ref(false)
const pendingRemoval = ref<{ action: ActionRef; resource: AdapterResourceRef } | null>(null)

/** Each confirmation is on screen exactly while it holds the thing it would act on. */
const openDialog = computed(() => pendingOpen.value !== null)
const removeDialog = computed(() => pendingRemoval.value !== null)

/** A resource named the way both confirmations show it: its type and its external id. */
function pendingTarget(pending: { resource: AdapterResourceRef } | null) {
  return pending ? `${pending.resource.resource_type}:${pending.resource.external_id}` : ''
}
const removeConfirmed = ref(false)
const busy = ref(false)
const error = ref('')
const feedback = ref('')

/**
 * What an action is called: its own title, then its adapter's, then the bare id.
 *
 * The fallbacks are a chain because a platform module may ship an action before the
 * catalogue has a phrase for it, and an unnamed button is worse than a raw id.
 */
function candidateLabel(naming: CandidateNaming): string {
  if (te(naming.titleKey)) return t(naming.titleKey)
  if (naming.adapterTitleKey && te(naming.adapterTitleKey)) return t(naming.adapterTitleKey)
  return naming.ownerId
}

const candidates = computed(() =>
  attachCandidates(
    props.registry,
    props.invocationScope,
    props.workItemRef.space_ref.data_scope_id,
  ),
)

const candidateOptions = computed<ChoiceOption[]>(() =>
  candidates.value.map((candidate) => ({
    value: candidate.key,
    // The resource type is added only when the action accepts more than one;
    // otherwise it says nothing the label does not.
    label:
      candidate.descriptor.resource_types.length > 1
        ? `${candidateLabel(candidate.naming)} · ${candidate.resource_type}`
        : candidateLabel(candidate.naming),
    icon: 'client',
  })),
)
const selected = computed(
  () => candidates.value.find((candidate) => candidate.key === selectedCandidate.value) ?? null,
)
const maxLength = computed(() => selected.value?.descriptor.fields[0].max_length ?? 128)
const canAttach = computed(() =>
  Boolean(selected.value && externalId.value.trim() && confirmed.value && !busy.value),
)
const projectId = computed(() =>
  props.invocationScope.kind === 'project' ? props.invocationScope.project_ref.project_id : '',
)
const spaceLabel = computed(
  () => `${props.workItemRef.reference} · ${props.workItemRef.space_ref.data_scope_id}`,
)
const attachTarget = computed(() =>
  selected.value && externalId.value.trim()
    ? `${selected.value.resource_type}:${externalId.value.trim()}`
    : t('platform.relations.targetPending'),
)

function descriptorFor(
  action: ActionRef,
  operation: ActionInputDescriptor['operation'],
): ActionInputDescriptor | undefined {
  return props.registry?.action_inputs.find(
    (item) => item.action_id === action.action_id && item.operation === operation,
  )
}

function beginAttach() {
  selectedCandidate.value = candidates.value[0]?.key ?? ''
  externalId.value = ''
  confirmed.value = false
  error.value = ''
  attachOpen.value = true
}

async function attach() {
  const candidate = selected.value
  const stableId = externalId.value.trim()
  if (!candidate || !stableId || !confirmed.value || props.invocationScope.kind !== 'project')
    return
  busy.value = true
  error.value = ''
  try {
    const resourceRef: AdapterResourceRef = {
      connection_ref: candidate.connection_ref,
      resource_type: candidate.resource_type,
      external_id: stableId,
    }
    const result = await mutatePlatformRelation({
      interface_version: RELATION_COMMAND_INTERFACE,
      operation: 'attach',
      entity_ref: planningWorkItemEntity(props.workItemRef),
      resource_ref: resourceRef,
      invocation_context: {
        view_scope: props.viewScope,
        invocation_scope: props.invocationScope,
        target: resourceRef,
      },
      action_ref: candidate.action,
      expected_revision: props.revision,
      confirmation: true,
      fallback_label: stableId,
    })
    attachOpen.value = false
    emit('changed', result.card_revision)
  } catch (error_) {
    error.value = (error_ as Error).message
  } finally {
    busy.value = false
  }
}

function invoke(relation: PlatformRelation, action: ActionRef) {
  const resourceRef = isAdapterResourceRef(relation.target) ? relation.target : null
  if (!resourceRef) return
  const operation =
    (['open', 'remove'] as const).find((candidate) => descriptorFor(action, candidate)) ?? null
  if (operation === null || busy.value) return
  if (operation === 'remove') {
    pendingRemoval.value = { action, resource: resourceRef }
    removeConfirmed.value = false
    error.value = ''
    return
  }
  pendingOpen.value = { action, resource: resourceRef }
  openConfirmed.value = false
  error.value = ''
  feedback.value = ''
}

function closeOpen() {
  pendingOpen.value = null
  openConfirmed.value = false
}

async function openRelation() {
  const pending = pendingOpen.value
  if (!pending || !openConfirmed.value || props.invocationScope.kind !== 'project' || busy.value)
    return
  busy.value = true
  error.value = ''
  feedback.value = ''
  try {
    const result = await invokePlatformAction({
      interface_version: ACTION_COMMAND_INTERFACE,
      action_ref: pending.action,
      invocation_context: {
        view_scope: props.viewScope,
        invocation_scope: props.invocationScope,
        target: pending.resource,
      },
      input: {
        entity_ref: planningWorkItemEntity(props.workItemRef),
        resource_ref: pending.resource,
      },
      confirmation: true,
    })
    closeOpen()
    const opened = window.open(result.target.uri, '_blank', 'noopener,noreferrer')
    if (opened === null) feedback.value = t('platform.relations.openBlocked')
  } catch (error_) {
    error.value = (error_ as Error).message
  } finally {
    busy.value = false
  }
}

function closeRemove() {
  pendingRemoval.value = null
  removeConfirmed.value = false
}

async function removeRelation() {
  const pending = pendingRemoval.value
  if (!pending || !removeConfirmed.value || props.invocationScope.kind !== 'project' || busy.value)
    return
  busy.value = true
  error.value = ''
  try {
    const result = await mutatePlatformRelation({
      interface_version: RELATION_COMMAND_INTERFACE,
      operation: 'remove',
      entity_ref: planningWorkItemEntity(props.workItemRef),
      resource_ref: pending.resource,
      invocation_context: {
        view_scope: props.viewScope,
        invocation_scope: props.invocationScope,
        target: pending.resource,
      },
      action_ref: pending.action,
      expected_revision: props.revision,
      confirmation: true,
    })
    closeRemove()
    emit('changed', result.card_revision)
  } catch (error_) {
    error.value = (error_ as Error).message
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <section
    class="platform-relations"
    aria-labelledby="platform-relations-title"
  >
    <header class="relations-head">
      <div>
        <SectionHeading
          as="h3"
          level="panel"
          class="panel-kicker"
          >{{ t('platform.relations.kicker') }}</SectionHeading
        >
        <h2
          id="platform-relations-title"
          class="relations-title"
        >
          {{ t('platform.relations.title') }}
        </h2>
      </div>
      <VButton
        :disabled="!candidates.length || busy"
        @click="beginAttach"
      >
        <VIcon
          name="external-link"
          :size="17"
        />{{ t('platform.relations.attach') }}
      </VButton>
    </header>

    <p
      v-if="error"
      class="relation-feedback error"
      role="alert"
    >
      {{ error }}
    </p>
    <p
      v-if="feedback"
      class="relation-feedback"
      role="status"
    >
      {{ feedback }}
    </p>

    <RelationList
      :relations="relations"
      :registry="registry"
      :busy="busy"
      @invoke="invoke"
    />

    <p
      v-if="!candidates.length"
      class="relation-owner-note"
    >
      {{ t('platform.relations.unavailable') }}
    </p>

    <RelationConfirm
      v-model:confirmed="confirmed"
      surface-class="platform-attach-dialog"
      :open="attachOpen"
      :title="t('platform.relations.attachTitle')"
      :intro="t('platform.relations.attachIntro')"
      :confirm-label="t('platform.relations.confirm')"
      :action-label="t('platform.relations.attach')"
      :project-id="projectId"
      :work-item="spaceLabel"
      :target="attachTarget"
      :busy="busy"
      :error="error"
      :ready="canAttach"
      @close="attachOpen = false"
      @submit="attach"
    >
      <div class="attach-field">
        <span class="attach-field-label">{{ t('platform.relations.adapterAction') }}</span>
        <SelectionControl
          mode="combobox"
          :model-value="selectedCandidate"
          :options="candidateOptions"
          :label="t('platform.relations.adapterAction')"
          @update:model-value="selectedCandidate = $event"
        />
      </div>
      <VTextInput
        v-model="externalId"
        autocomplete="off"
        :label="t('platform.relations.stableId')"
        :maxlength="maxLength"
        :spellcheck="false"
      />
    </RelationConfirm>

    <RelationConfirm
      v-model:confirmed="openConfirmed"
      surface-class="platform-open-dialog"
      :open="openDialog"
      :title="t('platform.relations.openTitle')"
      :intro="t('platform.relations.openIntro')"
      :confirm-label="t('platform.relations.confirmOpen')"
      :action-label="t('platform.relations.open')"
      :project-id="projectId"
      :work-item="spaceLabel"
      :target="pendingTarget(pendingOpen)"
      :busy="busy"
      :error="error"
      :ready="openConfirmed && !busy"
      @close="closeOpen"
      @submit="openRelation"
    />

    <RelationConfirm
      v-model:confirmed="removeConfirmed"
      surface-class="platform-remove-dialog"
      :open="removeDialog"
      :title="t('platform.relations.removeTitle')"
      :intro="t('platform.relations.removeIntro')"
      :confirm-label="t('platform.relations.confirmRemove')"
      :action-label="t('platform.relations.remove')"
      :project-id="projectId"
      :work-item="spaceLabel"
      :target="pendingTarget(pendingRemoval)"
      :busy="busy"
      :error="error"
      :ready="removeConfirmed && !busy"
      @close="closeRemove"
      @submit="removeRelation"
    />
  </section>
</template>

<style scoped>
.platform-relations {
  display: grid;
  gap: var(--space-3);
  padding: var(--space-4) 0;
  border-top: 1px solid var(--color-rule);

  .relations-head {
    display: flex;
    gap: var(--space-3);
    justify-content: space-between;
    align-items: flex-start;
  }

  .relations-title {
    margin: var(--space-half) 0 0;
    font-size: var(--font-size-section);
  }
}

.relation-feedback {
  padding: var(--space-2) var(--space-3);
  margin: 0;
  font-size: var(--font-size-dense);
  background: var(--color-surface-muted);

  &.error {
    border-inline-start: 3px solid var(--color-danger);
    color: var(--color-danger);
  }
}

.relation-owner-note {
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-note);
}

.attach-field {
  display: grid;
  gap: var(--space-2);

  .attach-field-label {
    font: var(--font-label);
  }
}
</style>
