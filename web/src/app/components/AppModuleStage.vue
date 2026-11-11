<script setup lang="ts">
import { computed, ref } from 'vue'

import { analyticsView, settingsView } from '@/app/moduleViews.ts'

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
  /** An address asked the card on show to go to its waiting question. */
  questionAsked: boolean
  route: PlatformRoute
  scope: OperatingScope
  /** The active manifest's bound on the route state a module writes. */
  stateBytes: number
}>()
const emit = defineEmits<{
  'connection': [state: 'connecting' | 'live' | 'reconnecting' | null]
  'entity': [entity?: EntityRef]
  'find': [text: string]
  'locale': [value: string]
  'notice': [message: string]
  'open-project': [projectId: string, moduleId?: ModuleId]
  'question-taken': []
  'state': [state: Record<string, string | number | boolean>, mode?: 'push' | 'replace']
}>()
const SettingsView = settingsView.component
const AnalyticsView = analyticsView.component
const planningSurface = ref<InstanceType<typeof PlanningModuleSurface> | null>(null)
async function refresh() {
  await planningSurface.value?.refresh()
}
function stateValue(key: string, fallback = '') {
  return String(props.route.state?.[key] ?? fallback)
}
/** The project a module scoped to one reads alone; null at the top. */
const scopeProject = computed(() =>
  props.scope.kind === 'project' ? props.scope.project_ref.project_id : null,
)
/** The work item whose card is on show, for as long as its module is. */
const openCardId = computed(() => planningSurface.value?.selectedId ?? null)
defineExpose({ openCardId, refresh })
</script>
<template>
  <PlanningModuleSurface
    v-if="activeModule === 'planning'"
    ref="planningSurface"
    :scope="scope"
    :route="route"
    :context="context"
    :primary-write-scope-id="primaryWriteScopeId"
    :question-asked="questionAsked"
    :state-bytes="stateBytes"
    @question-taken="emit('question-taken')"
    @connection="(state) => emit('connection', state)"
    @entity="(entity) => emit('entity', entity)"
    @find="(text) => emit('find', text)"
    @state="(state) => emit('state', state)"
    @notice="(message) => emit('notice', message)"
    @open-project="(id) => emit('open-project', id)"
  />

  <ModuleFrame
    v-else-if="activeModule === 'analytics'"
    module="analytics"
    :label="moduleTitle"
  >
    <AnalyticsView
      :route-state="route.state"
      :project-id="scopeProject"
      @state="(state, mode) => emit('state', state, mode)"
    />
  </ModuleFrame>

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
