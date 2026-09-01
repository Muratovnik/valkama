<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'

import RegistryRow from '@/widgets/settings-registry/components/RegistryRow.vue'
import RegistrySection from '@/widgets/settings-registry/components/RegistrySection.vue'
import { useRegistryLabels } from '@/widgets/settings-registry/composables/useRegistryLabels.ts'

import { resetProjectAssignment, setPlatformAssignment } from '@/shared/api/platformApi.ts'
import type {
  PlatformRegistryReady,
  RegistryAssignment,
  RegistryConnection,
} from '@/shared/api/platformApiTypes.ts'
import type { ChoiceOption } from '@/shared/ui/choiceControls.ts'
import ChoiceSelect from '@/shared/ui/ChoiceSelect.vue'
import SemanticState from '@/shared/ui/SemanticState.vue'
import VButton from '@/shared/ui/VButton.vue'

type CapabilityResolution = PlatformRegistryReady['capabilities'][number]
type CapabilityId = RegistryAssignment['capability_id']

const props = defineProps<{ payload: PlatformRegistryReady; projectId: string }>()
const emit = defineEmits<{ notice: [message: string]; retry: [] }>()
const { t } = useI18n()
const { named, reasonLabel } = useRegistryLabels()
const busy = ref('')

function connectionIdentity(connection: RegistryConnection): string {
  const ref = connection.connection_ref
  return `${ref.service_ref.owner_id}:${ref.service_ref.service_id}:${ref.adapter_lineage_id}:${ref.connection_id}`
}

function assignmentFor(
  capabilityId: CapabilityId,
  kind: 'installation' | 'project',
): RegistryAssignment | undefined {
  return props.payload.assignments.find(
    (assignment) =>
      assignment.capability_id === capabilityId &&
      assignment.scope.kind === kind &&
      (kind === 'installation' ||
        (assignment.scope.kind === 'project' && assignment.scope.project_id === props.projectId)),
  )
}

function connectionName(connectionId?: string): string {
  if (!connectionId) return t('platform.registry.unavailable')
  const connection = props.payload.connections.find(
    (item) => connectionIdentity(item) === connectionId,
  )
  return connection ? named(connection.name, connection.service.service_id) : connectionId
}

function details(resolution: CapabilityResolution) {
  const capabilityId = resolution.capability.capability_id
  const projectOverride = assignmentFor(capabilityId, 'project')
  const facts = [
    {
      label: t('platform.registry.installationDefault'),
      value: connectionName(assignmentFor(capabilityId, 'installation')?.connection_ids[0]),
    },
    {
      label: t('platform.registry.projectOverride'),
      value: projectOverride
        ? connectionName(projectOverride.connection_ids[0])
        : t('platform.registry.none'),
    },
  ]
  if (resolution.state === 'unavailable')
    facts.push({
      label: t('platform.registry.unavailableReason'),
      value: reasonLabel(resolution.reason),
    })
  return facts
}

function subtitle(resolution: CapabilityResolution): string {
  return `${t('platform.registry.effectiveSource')}: ${resolution.source ?? t('platform.registry.unavailable')}`
}

function selectedId(resolution: CapabilityResolution): string {
  return assignmentFor(resolution.capability.capability_id, 'project')?.connection_ids[0] ?? ''
}

function compatibleOptions(resolution: CapabilityResolution): ChoiceOption[] {
  return props.payload.connections
    .filter((connection) => connection.capabilities.includes(resolution.capability.capability_id))
    .map((connection) => ({
      description: connection.transport,
      label: named(connection.name, connection.service.service_id),
      value: connectionIdentity(connection),
    }))
}

function availabilityState(resolution: CapabilityResolution): 'ready' | 'unavailable' {
  return resolution.state === 'unavailable' ? 'unavailable' : 'ready'
}

function availabilityLabel(resolution: CapabilityResolution): string {
  return resolution.state === 'unavailable'
    ? reasonLabel(resolution.reason)
    : t('platform.registry.available')
}

function isBusy(resolution: CapabilityResolution): boolean {
  return busy.value === resolution.capability.capability_id
}

function configurationDisabled(resolution: CapabilityResolution): boolean {
  return isBusy(resolution) || compatibleOptions(resolution).length === 0
}

function canReset(resolution: CapabilityResolution): boolean {
  return Boolean(
    assignmentFor(resolution.capability.capability_id, 'project') && !isBusy(resolution),
  )
}

function mutationMessage(error: unknown): string {
  const conflict = error instanceof Error && 'status' in error && error.status === 409
  return t(conflict ? 'settings.mutation.assignmentConflict' : 'settings.mutation.assignmentFailed')
}

async function selectConnection(resolution: CapabilityResolution, connectionId: string) {
  if (!connectionId) return
  const capabilityId = resolution.capability.capability_id
  const override = assignmentFor(capabilityId, 'project')
  const expectedRevision = override === undefined ? 0 : override.revision
  busy.value = capabilityId
  emit('notice', '')
  try {
    await setPlatformAssignment(
      capabilityId,
      { kind: 'project', project_id: props.projectId },
      [connectionId],
      expectedRevision,
    )
    emit('retry')
  } catch (error) {
    emit('notice', mutationMessage(error))
  } finally {
    busy.value = ''
  }
}

async function resetOverride(resolution: CapabilityResolution) {
  const capabilityId = resolution.capability.capability_id
  const override = assignmentFor(capabilityId, 'project')
  if (override === undefined) return
  busy.value = capabilityId
  emit('notice', '')
  try {
    await resetProjectAssignment(capabilityId, props.projectId, override.revision)
    emit('retry')
  } catch (error) {
    emit('notice', mutationMessage(error))
  } finally {
    busy.value = ''
  }
}
</script>

<template>
  <RegistrySection
    kind="project-assignments"
    icon="check"
    title-key="platform.registry.projectAssignments"
    :count="payload.capabilities.length"
  >
    <RegistryRow
      v-for="resolution in payload.capabilities"
      :key="resolution.capability.capability_id"
      icon="check"
      :title="resolution.capability.capability_id"
      :subtitle="subtitle(resolution)"
      :details="details(resolution)"
    >
      <template #availability>
        <SemanticState
          dimension="integration-health"
          :state="availabilityState(resolution)"
          :label="availabilityLabel(resolution)"
        />
      </template>
      <template #configuration>
        <span class="assignment-controls">
          <span class="assignment-picker">
            <ChoiceSelect
              :model-value="selectedId(resolution)"
              :options="compatibleOptions(resolution)"
              :label="resolution.capability.capability_id"
              :placeholder="t('platform.registry.useInstallationDefault')"
              :empty-label="t('settings.noAvailableIntegrations')"
              :disabled="configurationDisabled(resolution)"
              @update:model-value="selectConnection(resolution, $event)"
            />
          </span>
          <VButton
            :disabled="!canReset(resolution)"
            @click="resetOverride(resolution)"
          >
            {{ t('platform.registry.resetDefault') }}
          </VButton>
        </span>
      </template>
    </RegistryRow>
  </RegistrySection>
</template>

<style scoped>
.assignment-controls {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  justify-content: flex-end;
  align-items: center;
  width: 100%;
  min-width: 0;
}

.assignment-picker {
  flex: 1 1 auto;
  min-width: 0;
}
</style>
