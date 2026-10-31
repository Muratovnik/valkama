<script setup lang="ts">
import { ref } from 'vue'

import { settingsView } from '@/app/moduleViews.ts'

import PlanningModuleSurface from '@/pages/planning/PlanningModuleSurface.vue'

import ModuleFrame from '@/widgets/module-frame/components/ModuleFrame.vue'

import type { PlatformContextReady } from '@/shared/api/platformApiTypes.ts'
import type { EntityRef } from '@/shared/api/platformEntityRef.ts'
import type { ModuleId } from '@/shared/api/platformModuleContract.ts'
import type { OperatingScope, PlatformRoute } from '@/shared/api/platformRoute.ts'

const props = defineProps<{
  activeModule: ModuleId
  context: PlatformContextReady | null
  locale: string
  moduleTitle: string
  primaryWriteScopeId: string | null
  route: PlatformRoute
  scope: OperatingScope
}>()
const emit = defineEmits<{
  'connection': [state: 'connecting' | 'live' | 'reconnecting' | null]
  'entity': [entity?: EntityRef]
  'locale': [value: string]
  'notice': [message: string]
  'open-project': [projectId: string, moduleId?: ModuleId]
  'open-session': [sessionId: string, clientFamily: string]
  'state': [state: Record<string, string | number | boolean>]
}>()
const SettingsView = settingsView.component
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
      @locale="(value) => emit('locale', value)"
      @state="(state) => emit('state', state)"
    />
  </ModuleFrame>
</template>
