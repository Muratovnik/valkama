<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'

import ProjectAssignmentsSection from '@/widgets/settings-registry/components/ProjectAssignmentsSection.vue'
import RegistryRow from '@/widgets/settings-registry/components/RegistryRow.vue'
import RegistrySection from '@/widgets/settings-registry/components/RegistrySection.vue'
import { useRegistryLabels } from '@/widgets/settings-registry/composables/useRegistryLabels.ts'

import { setModuleState } from '@/shared/api/platformApi.ts'
import type {
  PlatformRegistryReady,
  RegistryAssignment,
  RegistryConnection,
} from '@/shared/api/platformApiTypes.ts'
import type { ModuleRegistration } from '@/shared/api/platformModuleContract.ts'
import type { OperatingScope } from '@/shared/api/platformRoute.ts'
import type { PlatformUiState } from '@/shared/api/platformUiState.ts'
import CountBadge from '@/shared/ui/CountBadge.vue'
import DataEmptyState from '@/shared/ui/DataEmptyState.vue'
import PlatformStatePanel from '@/shared/ui/PlatformStatePanel.vue'
import SemanticState from '@/shared/ui/SemanticState.vue'
import ToggleSwitch from '@/shared/ui/ToggleSwitch.vue'

type CapabilityId = RegistryAssignment['capability_id']
type IntegrationGroup = {
  icon: string
  key: 'execution' | 'telemetry' | 'skills' | 'memory' | 'artifacts'
  owns: (capability: CapabilityId) => boolean
}

const props = defineProps<{
  scope: OperatingScope
  state: PlatformUiState<PlatformRegistryReady>
  reloadModules: () => Promise<void>
}>()
const emit = defineEmits<{ retry: [] }>()
const { t } = useI18n()
const { connectionDetails, named, reasonLabel } = useRegistryLabels()
const lifecycleNotice = ref('')
const moduleBusy = ref('')

const integrationGroups: IntegrationGroup[] = [
  {
    key: 'execution',
    icon: 'play',
    owns: (id) => id.startsWith('execution.') || id === 'session.observe',
  },
  { key: 'telemetry', icon: 'activity', owns: (id) => id === 'telemetry.query' },
  { key: 'skills', icon: 'sparkles', owns: (id) => id.startsWith('skills.') },
  { key: 'memory', icon: 'database', owns: (id) => id.startsWith('memory.') },
  { key: 'artifacts', icon: 'git-branch', owns: (id) => id === 'artifact.inspect' },
]

async function updateModule(registration: ModuleRegistration, enabled: boolean) {
  if (!registration.mutable || moduleBusy.value) return
  moduleBusy.value = registration.manifest.module_id
  lifecycleNotice.value = ''
  try {
    await setModuleState(
      registration.manifest.module_id,
      enabled ? 'enabled' : 'disabled',
      registration.revision,
    )
    await props.reloadModules()
  } catch (error) {
    const conflict = error instanceof Error && 'status' in error && error.status === 409
    lifecycleNotice.value = t(
      conflict ? 'settings.mutation.moduleConflict' : 'settings.mutation.moduleFailed',
    )
    if (conflict) await props.reloadModules()
  } finally {
    moduleBusy.value = ''
  }
}

function connectionsFor(payload: PlatformRegistryReady, group: IntegrationGroup) {
  return payload.connections.filter((connection) =>
    connection.capabilities.some((capability) => group.owns(capability)),
  )
}

function populatedIntegrationGroups(payload: PlatformRegistryReady) {
  return integrationGroups
    .map((group) => ({ ...group, connections: connectionsFor(payload, group) }))
    .filter((group) => group.connections.length > 0)
}

function integrationCount(payload: PlatformRegistryReady): number {
  return populatedIntegrationGroups(payload).reduce(
    (total, group) => total + group.connections.length,
    0,
  )
}

function hasContent(payload: PlatformRegistryReady): boolean {
  return (
    payload.modules.length > 0 ||
    integrationCount(payload) > 0 ||
    (props.scope.kind === 'project' && payload.capabilities.length > 0)
  )
}

function connectionIdentity(connection: RegistryConnection): string {
  const ref = connection.connection_ref
  return `${ref.service_ref.owner_id}:${ref.service_ref.service_id}:${ref.adapter_lineage_id}:${ref.connection_id}`
}

function moduleAvailability(
  payload: PlatformRegistryReady,
  registration: ModuleRegistration,
): { label: string; state: 'ready' | 'unavailable' } {
  const resolutions = registration.manifest.feature_capabilities
    .map((id) => payload.capabilities.find((entry) => entry.capability.capability_id === id))
    .filter((entry) => entry !== undefined)
  const unavailable = resolutions.find((entry) => entry.state === 'unavailable')
  return unavailable
    ? { label: reasonLabel(unavailable.reason), state: 'unavailable' }
    : { label: t('platform.registry.available'), state: 'ready' }
}

function moduleEnabled(registration: ModuleRegistration): boolean {
  return registration.state === 'enabled'
}

function moduleEnablementLabel(registration: ModuleRegistration): string {
  return t(registration.state === 'enabled' ? 'settings.enabled' : 'settings.disabled')
}

function moduleIsBusy(registration: ModuleRegistration): boolean {
  return moduleBusy.value === registration.manifest.module_id
}

function connectionFacts(connection: RegistryConnection) {
  const details = connectionDetails(connection)
  return connection.diagnostics
    ? [
        ...details,
        { label: t('platform.registry.diagnostics'), value: connection.diagnostics.message },
      ]
    : details
}

function noteLifecycle(message: string) {
  lifecycleNotice.value = message
}
</script>

<template>
  <PlatformStatePanel
    :state="state"
    @retry="emit('retry')"
  >
    <template #default="{ payload }">
      <p
        v-if="lifecycleNotice"
        class="registry-notice"
        role="alert"
      >
        {{ lifecycleNotice }}
      </p>
      <div
        v-if="hasContent(payload)"
        class="registry-stack"
      >
        <RegistrySection
          v-if="payload.modules.length"
          kind="modules"
          icon="layout-dashboard"
          title-key="platform.registry.modules"
          :count="payload.modules.length"
        >
          <RegistryRow
            v-for="module in payload.modules"
            :key="module.manifest.module_id"
            :icon="module.manifest.icon_key"
            :title="named(module.manifest.title_key, module.manifest.module_id)"
            :subtitle="t(`platform.navigation.groups.${module.manifest.navigation_group}`)"
          >
            <template #availability>
              <SemanticState
                dimension="integration-health"
                :state="moduleAvailability(payload, module).state"
                :label="moduleAvailability(payload, module).label"
              />
            </template>
            <template #enablement>
              <ToggleSwitch
                v-if="module.mutable"
                :model-value="moduleEnabled(module)"
                :label="named(module.manifest.title_key, module.manifest.module_id)"
                :busy="moduleIsBusy(module)"
                :on-label="t('settings.enabled')"
                :off-label="t('settings.disabled')"
                @update:model-value="(enabled) => updateModule(module, enabled)"
              />
              <SemanticState
                v-else
                dimension="integration-intake"
                :state="module.state"
                :label="moduleEnablementLabel(module)"
              />
            </template>
          </RegistryRow>
        </RegistrySection>

        <section
          v-if="integrationCount(payload)"
          class="integrations"
          aria-labelledby="integrations-title"
        >
          <header class="integrations-head">
            <span class="integrations-titleline">
              <h3
                id="integrations-title"
                class="integrations-title"
              >
                {{ t('platform.registry.integrations') }}
              </h3>
              <CountBadge
                placement="inline"
                :value="integrationCount(payload)"
              />
            </span>
            <p class="integrations-intro">{{ t('platform.registry.integrationsIntro') }}</p>
          </header>
          <div class="integration-stack">
            <RegistrySection
              v-for="group in populatedIntegrationGroups(payload)"
              :key="group.key"
              :kind="`integrations-${group.key}`"
              :icon="group.icon"
              :title-key="`platform.registry.integrationGroups.${group.key}`"
              :count="group.connections.length"
            >
              <RegistryRow
                v-for="connection in group.connections"
                :key="connectionIdentity(connection)"
                :icon="group.icon"
                :title="named(connection.name, connection.service.service_id)"
                :configuration-owner="connection.configuration_owner"
                :details="connectionFacts(connection)"
              >
                <template #health>
                  <SemanticState
                    dimension="integration-health"
                    :state="connection.health"
                    :label="t(`platform.registry.health.${connection.health}`)"
                  />
                </template>
              </RegistryRow>
            </RegistrySection>
          </div>
        </section>

        <ProjectAssignmentsSection
          v-if="scope.kind === 'project' && payload.capabilities.length"
          :payload="payload"
          :project-id="scope.project_ref.project_id"
          @notice="noteLifecycle"
          @retry="emit('retry')"
        />
      </div>
      <DataEmptyState
        v-else
        :title="t('settings.workspaceEmpty')"
        :description="t('settings.workspaceEmptyDetail')"
      />
    </template>
  </PlatformStatePanel>
</template>

<style scoped>
.registry-stack,
.integration-stack {
  display: grid;
  gap: var(--space-4);
}

.integrations-head {
  margin-block-end: var(--space-3);
}

.integrations-titleline {
  display: flex;
  gap: var(--space-2);
  align-items: center;
}

.integrations-title,
.integrations-intro {
  margin: 0;
}

.integrations-intro {
  color: var(--color-text-muted);
  font: var(--font-note);
}

.registry-notice {
  padding: var(--space-2) var(--space-3);
  margin: 0 0 var(--space-3);
  border-inline-start: 1px solid var(--color-danger);
  color: var(--color-danger);
  font-size: var(--font-size-dense);
  background: var(--color-surface-muted);
}
</style>
