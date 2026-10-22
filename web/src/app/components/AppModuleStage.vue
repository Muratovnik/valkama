<script setup lang="ts">
import { computed, ref } from 'vue'

import PlanningModuleSurface from '@/pages/planning/PlanningModuleSurface.vue'
import SettingsView from '@/pages/settings/SettingsView.vue'

import ModuleFrame from '@/widgets/module-frame/components/ModuleFrame.vue'

import type { PlatformContextReady, PlatformRegistryReady } from '@/shared/api/platformApiTypes.ts'
import type { EntityRef } from '@/shared/api/platformEntityRef.ts'
import type { ModuleId } from '@/shared/api/platformModuleContract.ts'
import type { OperatingScope, PlatformRoute } from '@/shared/api/platformRoute.ts'
import type { PlatformUiState } from '@/shared/api/platformUiState.ts'
const props = defineProps<{
  activeModule: ModuleId
  context: PlatformContextReady | null
  locale: string
  moduleTitle: string
  primaryWriteScopeId: string | null
  registryState: PlatformUiState<PlatformRegistryReady>
  route: PlatformRoute
  scope: OperatingScope
  reloadModules: () => Promise<void>
}>()
const emit = defineEmits<{
  'connection': [state: 'connecting' | 'live' | 'reconnecting']
  'entity': [entity?: EntityRef]
  'locale': [value: string]
  'notice': [message: string]
  'open-project': [projectId: string, moduleId?: ModuleId]
  'open-session': [sessionId: string, clientFamily: string]
  'retry-registry': []
  'state': [state: Record<string, string | number | boolean>]
}>()
const registryReady = computed(() =>
  props.registryState.status === 'ready' || props.registryState.status === 'degraded'
    ? props.registryState.payload
    : null,
)
const planningSurface = ref<InstanceType<typeof PlanningModuleSurface> | null>(null)
async function refresh() {
  await planningSurface.value?.refresh()
}
function stateValue(key: string, fallback = '') {
  return String(props.route.state?.[key] ?? fallback)
}
defineExpose({ refresh })
</script>
<template>
  <PlanningModuleSurface
    v-if="activeModule === 'planning'"
    ref="planningSurface"
    :scope="scope"
    :route="route"
    :context="context"
    :registry="registryReady"
    :primary-write-scope-id="primaryWriteScopeId"
    @connection="(state) => emit('connection', state)"
    @entity="(entity) => emit('entity', entity)"
    @state="(state) => emit('state', state)"
    @notice="(message) => emit('notice', message)"
    @open-project="(id) => emit('open-project', id)"
    @open-session="(id, family) => emit('open-session', id, family)"
  />

  <ModuleFrame
    v-else-if="activeModule === 'settings'"
    module="settings"
    :label="moduleTitle"
  >
    <SettingsView
      :locale="locale"
      :section="stateValue('section', 'general')"
      :scope="scope"
      :registry-state="registryState"
      :reload-modules="reloadModules"
      @retry="emit('retry-registry')"
      @locale="(value) => emit('locale', value)"
      @state="(state) => emit('state', state)"
    />
  </ModuleFrame>
</template>
