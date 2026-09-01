<script setup lang="ts">
/**
 * Which module's screen is showing, and what it is handed.
 *
 * Two of the seven answer the scope question with a refusal rather than a
 * screen: sessions and improvements are global surfaces, and a project scope has
 * nothing for them to show. Saying so with a way out — one button back to global
 * — is the difference between an empty module and a dead end.
 *
 * Memory answers it with a different screen instead. Globally there is no single
 * knowledge root to search, but there is a real thing to show — which provider
 * answers for which project — so the scope changes what the module is for rather
 * than whether it has anything to say.
 *
 * Planning is the one module not wrapped in a `ModuleFrame`: it manages its own
 * scroll and its own three views, so a frame around it would be a second scroll
 * container inside the first.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import AnalyticsView from '@/pages/analytics/AnalyticsView.vue'
import ImprovementsView from '@/pages/improvements/components/ImprovementsView.vue'
import MemoryView from '@/pages/memory/components/MemoryView.vue'
import PlanningModuleSurface from '@/pages/planning/PlanningModuleSurface.vue'
import SessionsView from '@/pages/sessions/SessionsView.vue'
import SettingsView from '@/pages/settings/SettingsView.vue'
import SkillsView from '@/pages/skills/components/SkillsView.vue'

import ModuleFrame from '@/widgets/module-frame/components/ModuleFrame.vue'

import type { PlatformContextReady, PlatformRegistryReady } from '@/shared/api/platformApiTypes.ts'
import type { EntityRef } from '@/shared/api/platformEntityRef.ts'
import type { ModuleId } from '@/shared/api/platformModuleContract.ts'
import type { OperatingScope, PlatformRoute } from '@/shared/api/platformRoute.ts'
import { uiUnavailable } from '@/shared/api/platformUiState.ts'
import type { PlatformUiState } from '@/shared/api/platformUiState.ts'
import type {
  SessionWorkItemNavigationTarget,
  WorkItemNavigationTarget,
} from '@/shared/types/reference.ts'
import type { AgentSession } from '@/shared/types/session.ts'
import PlatformStatePanel from '@/shared/ui/PlatformStatePanel.vue'
import VButton from '@/shared/ui/VButton.vue'

const props = defineProps<{
  activeModule: ModuleId
  context: PlatformContextReady | null
  locale: string
  moduleTitle: string
  primaryWriteScopeId: string | null
  registryState: PlatformUiState<PlatformRegistryReady>
  route: PlatformRoute
  scope: OperatingScope
  sessionRevisions: Readonly<Record<string, string>>
  sessionsState: PlatformUiState<{ inbox: AgentSession[]; sessions: AgentSession[] }>
  reloadModules: () => Promise<void>
}>()

const emit = defineEmits<{
  'entity': [entity?: EntityRef]
  'locale': [value: string]
  'notice': [message: string]
  'open-project': [projectId: string, moduleId?: ModuleId]
  'open-session': [sessionId: string, clientFamily: string]
  'open-session-work-item': [target: SessionWorkItemNavigationTarget]
  'open-work-item': [target: WorkItemNavigationTarget]
  'retry-registry': []
  'retry-sessions': []
  'skill-route': [skill: { key: string; scope: 'global' | 'project'; project_id?: string } | null]
  'state': [state: Record<string, string | number | boolean>]
  'switch-scope': [value: string]
}>()

const { t } = useI18n()

/**
 * Which session the route has open, and the entity that puts one there.
 *
 * A session is an entity kind the Kernel already declares, so the route can
 * carry it exactly as it carries a work item. Keeping the selection in the page
 * would have made it unlinkable and unreachable from the work item that names
 * it, which is half of what this layer had to deliver.
 */
const openSessionId = computed(() =>
  props.route.entity?.kind === 'session' ? props.route.entity.session_id : null,
)

/** Selecting one writes it into the route; closing the drawer clears it. */
function selectSession(session: AgentSession | null) {
  emit(
    'entity',
    session === null
      ? undefined
      : {
          kind: 'session',
          session_id: session.id,
          client_family: session.client_family ?? 'other',
        },
  )
}

/** A string from the URL's state bag, which is untyped by design. */
function stateValue(key: string, fallback = ''): string {
  return String(props.route.state?.[key] ?? fallback)
}

/** Skills are filed per project, and `global` is a scope rather than a project id. */
const skillsProject = computed(() =>
  props.scope.kind === 'project' ? props.scope.project_ref.project_id : 'global',
)

/** Only a skill route opens a skill; any other entity leaves the catalogue closed. */
const skillsKey = computed(() =>
  props.route.entity?.kind === 'skill' ? props.route.entity.skill_key : '',
)

const registryReady = computed(() =>
  props.registryState.status === 'ready' || props.registryState.status === 'degraded'
    ? props.registryState.payload
    : null,
)
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
    v-else-if="activeModule === 'sessions'"
    module="sessions"
    :label="moduleTitle"
  >
    <div
      v-if="scope.kind === 'project'"
      class="module-scope-note padded"
    >
      <PlatformStatePanel
        :state="uiUnavailable(t('platform.sessionsScope.projectNote'))"
        :retryable="false"
      >
        <template #action>
          <VButton @click="emit('switch-scope', 'global')">
            {{ t('platform.sessionsScope.showGlobal') }}
          </VButton>
        </template>
      </PlatformStatePanel>
    </div>
    <SessionsView
      v-else
      :state="sessionsState"
      :selected="openSessionId"
      :revisions="sessionRevisions"
      @retry="emit('retry-sessions')"
      @select="selectSession"
      @open-work-item="(target) => emit('open-session-work-item', target)"
    />
  </ModuleFrame>

  <ModuleFrame
    v-else-if="activeModule === 'analytics'"
    module="analytics"
    :label="moduleTitle"
  >
    <AnalyticsView
      :scope="scope"
      :entity="route.entity"
      :primary-write-scope-id="primaryWriteScopeId"
      :context="context"
      @open="(entity) => emit('entity', entity)"
    />
  </ModuleFrame>

  <ModuleFrame
    v-else-if="activeModule === 'improvements'"
    module="improvements"
    :label="moduleTitle"
  >
    <div
      v-if="scope.kind === 'project'"
      class="module-scope-note"
    >
      <PlatformStatePanel
        :state="uiUnavailable(t('platform.improvementsScope.projectNote'))"
        :retryable="false"
      >
        <template #action>
          <VButton @click="emit('switch-scope', 'global')">
            {{ t('platform.improvementsScope.showGlobal') }}
          </VButton>
        </template>
      </PlatformStatePanel>
    </div>
    <ImprovementsView
      v-else
      scope="personal"
      :status="stateValue('status')"
      @state="(state) => emit('state', state)"
    />
  </ModuleFrame>

  <ModuleFrame
    v-else-if="activeModule === 'skills'"
    module="skills"
    :label="moduleTitle"
  >
    <SkillsView
      :project="skillsProject"
      :skill="skillsKey"
      :query="stateValue('query')"
      :status="stateValue('status', 'all')"
      :view="stateValue('view', 'catalog')"
      @route="({ skill }) => emit('skill-route', skill)"
      @state="(state) => emit('state', state)"
    />
  </ModuleFrame>

  <ModuleFrame
    v-else-if="activeModule === 'memory'"
    module="memory"
    :label="moduleTitle"
  >
    <MemoryView
      :scope="scope"
      :query="stateValue('query')"
      @open-project="(id) => emit('open-project', id, 'memory')"
      @open-work-item="(target) => emit('open-work-item', target)"
      @state="(state) => emit('state', state)"
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
      :scope="scope"
      :registry-state="registryState"
      :reload-modules="reloadModules"
      @retry="emit('retry-registry')"
      @locale="(value) => emit('locale', value)"
      @state="(state) => emit('state', state)"
    />
  </ModuleFrame>
</template>

<style scoped>
.module-scope-note {
  display: grid;
  gap: var(--space-4);

  /* Sessions carries its refusal inside the module column, because its own screen
     would have stood there; improvements fills its frame either way. */
  &.padded {
    width: min(var(--size-module-column), 100%);
    padding: var(--space-6) var(--size-page-gutter) var(--space-12);
    margin: 0 auto;
  }
}
</style>
