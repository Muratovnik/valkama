<script setup lang="ts">
import { computed } from 'vue'

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
function stateValue(key: string, fallback = '') {
  return String(props.route.state?.[key] ?? fallback)
}
</script>
<template>
  <PlanningModuleSurface
    v-if="activeModule === 'planning'"
    :scope="scope"
    :route="route"
    :context="context"
    :registry="registryReady"
    :primary-write-scope-id="primaryWriteScopeId"
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
