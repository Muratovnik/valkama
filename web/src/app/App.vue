<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import AppContextBar from '@/app/components/AppContextBar.vue'
import AppModuleStage from '@/app/components/AppModuleStage.vue'
import AppRouteRecovery from '@/app/components/AppRouteRecovery.vue'
import {
  resolveResourceSelection,
  selectableProjectResources,
  useModuleRouteAuthority,
} from '@/app/composables/useModuleRouteAuthority.ts'
import { usePlatformEntryRestore } from '@/app/composables/usePlatformEntryRestore.ts'
import { usePlatformLiveFeed } from '@/app/composables/usePlatformLiveFeed.ts'
import { DEFAULT_ROUTE, usePlatformNavigation } from '@/app/composables/usePlatformNavigation.ts'
import { usePlatformReadModels } from '@/app/composables/usePlatformReadModels.ts'

import AppNav from '@/widgets/app-nav/components/AppNav.vue'

import SessionContext from '@/features/session-open/SessionContext.vue'
import { resolveSessionWorkItemRoute } from '@/features/session-open/sessionWorkItemRoute.ts'

import { fetchSessionContext } from '@/shared/api/api.ts'
import type { PlanningConnectionState } from '@/shared/api/planningApi.ts'
import type { EntityRef } from '@/shared/api/platformEntityRef.ts'
import { failureMessage } from '@/shared/api/typedFailure.ts'
import type { TypedFailure } from '@/shared/api/typedFailure.ts'
import type { ResolvedRef } from '@/shared/types/reference.ts'

const { t, te, locale } = useI18n()
const notice = ref('')

function localizedFailure(failure: TypedFailure): string {
  const message = failureMessage(failure)
  return t(message.key, message.params ?? {})
}

const {
  activeModule,
  entryRestorePending,
  goHome,
  openProject,
  operatingScope,
  pendingSession,
  route,
  routeBlocked,
  routeFailure,
  routeUnavailable: parsedRouteUnavailable,
  switchModule,
  switchScope,
  updateModuleState,
  writeRoute,
} = usePlatformNavigation(() => t('platform.route.invalid'))

const contextReady = computed(() =>
  contextState.value.status === 'ready' || contextState.value.status === 'degraded'
    ? contextState.value.payload
    : null,
)
const mappedProjectResources = computed(() => {
  const scope = operatingScope.value
  if (scope.kind !== 'project') return []
  return (
    contextReady.value?.projects.find(
      (project) => project.project_id === scope.project_ref.project_id,
    )?.resources ?? []
  )
})
const moduleAuthorityReady = ref(false)
const moduleStage = ref<InstanceType<typeof AppModuleStage> | null>(null)
const planningConnection = ref<PlanningConnectionState>('connecting')
const { contextState, registryState, loadContext, loadRegistry, syncRouteResources } =
  usePlatformReadModels({
    route,
    module: activeModule,
    blocked: computed(() => routeBlocked.value || !moduleAuthorityReady.value),
  })

const {
  modules,
  moduleRegistrations,
  modulesAuthoritative,
  modulesSettled,
  modulesFailure,
  connectionState,
  refreshing,
  loadModules,
  refreshAll,
} = usePlatformLiveFeed({
  notice,
  moduleAuthorityReady,
  syncRouteResources,
  loadContext,
  refreshSurface: async () => {
    await nextTick()
    if (!['empty', 'ready'].includes(contextState.value.status))
      throw new Error('Context refresh failed')
    if (
      activeModule.value === 'settings' &&
      !['empty', 'ready'].includes(registryState.value.status)
    )
      throw new Error('Registry refresh failed')
    await moduleStage.value?.refresh()
  },
  text: {
    failure: localizedFailure,
    refreshed: () => t('refresh.done'),
  },
})

const displayedConnection = computed(() =>
  activeModule.value === 'planning' && operatingScope.value.kind === 'project'
    ? planningConnection.value
    : connectionState.value,
)

const {
  activeManifest,
  moduleTitle,
  reloadModuleState,
  routeFailure: liveRouteFailure,
  routeUnavailable,
} = useModuleRouteAuthority({
  loadModules,
  loadRegistry,
  modules,
  modulesAuthoritative,
  modulesSettled,
  parsedUnavailable: parsedRouteUnavailable,
  registrations: moduleRegistrations,
  route,
  te,
  translate: t,
})
const availableProjectResources = computed(() =>
  modulesAuthoritative.value
    ? selectableProjectResources(activeManifest.value, mappedProjectResources.value)
    : [],
)
const selectedResourceRef = computed<EntityRef | undefined>(() => {
  const entity = route.value.entity
  let selected: EntityRef | undefined
  if (entity !== undefined) {
    const encoded = JSON.stringify(entity)
    if (
      availableProjectResources.value.some(
        (resource) => JSON.stringify(resource.resource_ref) === encoded,
      )
    )
      selected = entity
  }
  return selected
})
const routeRecoveryFailure = computed(
  () =>
    routeFailure.value ||
    liveRouteFailure.value ||
    (modulesAuthoritative.value ? '' : modulesFailure.value),
)
const primaryWriteScopeId = computed(() =>
  contextReady.value?.primary.is_writable === true
    ? contextReady.value.primary.data_scope_id
    : null,
)
function selectResource(value: string) {
  const selected = availableProjectResources.value.find(
    (resource) => JSON.stringify(resource.resource_ref) === value,
  )
  const proposed =
    selected && modulesAuthoritative.value
      ? resolveResourceSelection(activeManifest.value, route.value, selected)
      : null
  if (proposed === null) {
    notice.value = t('platform.route.invalid')
    return
  }
  writeRoute(proposed)
}

function openEntity(entity?: EntityRef) {
  writeRoute({
    module_id: activeModule.value,
    scope: operatingScope.value,
    ...(entity ? { entity } : {}),
    state: route.value.state,
  })
}

async function openSession(sessionId: string, _clientFamily: string, navigate = false) {
  try {
    const context = await fetchSessionContext(sessionId)
    if (navigate && context.resolved && context.work_item && context.space_root?.resource_ref) {
      const next = resolveSessionWorkItemRoute(
        context.space_root.resource_ref,
        context.work_item,
        contextReady.value,
        moduleRegistrations.value,
      )
      if (next) {
        writeRoute(next)
        return
      }
    }
    sessionContext.value = context
  } catch (error) {
    notice.value = localizedFailure({ code: 'request_failed', status: null, retryable: true })
    console.error(error)
  }
}
const sessionContext = ref<ResolvedRef | null>(null)
watch([pendingSession, modulesSettled, contextReady], () => {
  if (!pendingSession.value || !modulesSettled.value || !contextReady.value) return
  const id = pendingSession.value
  pendingSession.value = ''
  void openSession(id, '', true)
})
function selectLocale(requested: string) {
  const value = requested === 'ru' ? 'ru' : 'en'
  locale.value = value
  localStorage.setItem('valkama-locale', value)
  document.documentElement.lang = value
}

watch(
  [
    () => route.value.module_id,
    () => JSON.stringify(route.value.scope),
    () => JSON.stringify(route.value.entity),
  ],
  () => {
    void syncRouteResources()
  },
  { immediate: true },
)

usePlatformEntryRestore({
  route,
  contextState,
  contextReady,
  modules,
  modulesSettled,
  entryRestorePending,
  blocked: routeBlocked,
  defaultRoute: DEFAULT_ROUTE,
  writeRoute,
})
</script>

<template>
  <a
    class="skip-link"
    href="#main-content"
    >{{ t('accessibility.skipToContent') }}</a
  >
  <div class="app-shell">
    <AppNav
      :modules="modules"
      :active="activeModule"
      :connection="displayedConnection"
      :refreshing="refreshing"
      @navigate="switchModule"
      @home="goHome"
      @refresh="refreshAll"
    />

    <div class="app-main">
      <AppContextBar
        :title="moduleTitle"
        :description="t(`modules.description.${activeModule}`)"
        :scope="operatingScope"
        :resource-ref="selectedResourceRef"
        :resources="availableProjectResources"
        :projects="contextReady?.projects ?? []"
        @scope="switchScope"
        @resource="selectResource"
      />

      <div
        id="main-content"
        class="module-stage"
        tabindex="-1"
      >
        <AppRouteRecovery
          v-if="entryRestorePending || !modulesSettled || routeRecoveryFailure || routeUnavailable"
          :pending="entryRestorePending || !modulesSettled"
          :failure="routeRecoveryFailure"
          :unavailable="routeUnavailable"
          @home="goHome"
          @choose="switchModule"
        />

        <AppModuleStage
          v-else-if="modulesAuthoritative && activeManifest"
          ref="moduleStage"
          :active-module="activeModule"
          :module-title="moduleTitle"
          :scope="operatingScope"
          :primary-write-scope-id="primaryWriteScopeId"
          :registry-state="registryState"
          :context="contextReady"
          :route="route"
          :locale="locale"
          :reload-modules="reloadModuleState"
          @connection="(state) => (planningConnection = state)"
          @retry-registry="loadRegistry"
          @entity="openEntity"
          @open-session="openSession"
          @notice="(message) => (notice = message)"
          @open-project="openProject"
          @switch-scope="switchScope"
          @state="updateModuleState"
          @locale="selectLocale"
        />
      </div>

      <SessionContext
        v-if="sessionContext"
        :context="sessionContext"
        @close="sessionContext = null"
      />
      <div
        v-if="notice"
        class="notice"
        role="status"
      >
        {{ notice }}
      </div>
    </div>
  </div>
</template>

<style scoped>
/* The workspace, as a panel lying on the chrome. One outside corner — where
   the rail and the context bar hand over — is rounded, and the two edges that
   meet there carry the hairline. The other three sides run to the window, so
   the shape costs no working width. */
.module-stage {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  background: var(--color-canvas);
  overflow: hidden;
  border-top-left-radius: var(--radius-shell);
  container: workspace / inline-size;
}

.notice {
  position: fixed;
  right: 18px;
  bottom: 18px;
  z-index: 70;
  max-width: 520px;
  padding: var(--space-3);
  border: 1px solid var(--color-rule-strong);
  color: var(--color-text);
  font-size: var(--font-size-dense);
  background: var(--color-surface);
  border-radius: var(--radius-card);
  box-shadow: var(--shadow-overlay);
}
</style>
