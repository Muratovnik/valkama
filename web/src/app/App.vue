<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import AppContextBar from '@/app/components/AppContextBar.vue'
import AppDocumentPage from '@/app/components/AppDocumentPage.vue'
import AppModuleStage from '@/app/components/AppModuleStage.vue'
import AppNotice from '@/app/components/AppNotice.vue'
import AppRequestsHub from '@/app/components/AppRequestsHub.vue'
import AppRouteRecovery from '@/app/components/AppRouteRecovery.vue'
import { useAlertPresence } from '@/app/composables/useAlertPresence.ts'
import { useAppDocuments } from '@/app/composables/useAppDocuments.ts'
import { useAppReferenceLinks } from '@/app/composables/useAppReferenceLinks.ts'
import { useDocumentOpening } from '@/app/composables/useDocumentOpening.ts'
import { useGlobalWorkActions } from '@/app/composables/useGlobalWorkActions.ts'
import { useLiveWorkFeed } from '@/app/composables/useLiveWorkFeed.ts'
import { useLiveWorkNav } from '@/app/composables/useLiveWorkNav.ts'
import { useModuleRouteAuthority } from '@/app/composables/useModuleRouteAuthority.ts'
import { usePlatformEntryRestore } from '@/app/composables/usePlatformEntryRestore.ts'
import { usePlatformLiveFeed } from '@/app/composables/usePlatformLiveFeed.ts'
import { DEFAULT_ROUTE, usePlatformNavigation } from '@/app/composables/usePlatformNavigation.ts'
import { usePlatformReadModels } from '@/app/composables/usePlatformReadModels.ts'
import { useProjectResources } from '@/app/composables/useProjectResources.ts'
import { useSessionOpening } from '@/app/composables/useSessionOpening.ts'
import { useShellNotice } from '@/app/composables/useShellNotice.ts'
import { prefetchModule } from '@/app/moduleViews.ts'

import AppNav from '@/widgets/app-nav/components/AppNav.vue'
import DocumentDrawer from '@/widgets/document-viewer/components/DocumentDrawer.vue'

import GlobalWorkFinder from '@/features/global-find/GlobalWorkFinder.vue'
import { provideOpenNotice } from '@/features/session-open/openNotice.ts'
import SessionContext from '@/features/session-open/SessionContext.vue'
import WorkItemLinkPanel from '@/features/work-item-link/WorkItemLinkPanel.vue'

import type { PlanningConnectionState } from '@/shared/api/planningApi.ts'
import type { EntityRef } from '@/shared/api/platformEntityRef.ts'
import { failureMessage } from '@/shared/api/typedFailure.ts'
import type { TypedFailure } from '@/shared/api/typedFailure.ts'
import { provideProjectTitles } from '@/shared/lib/projectTitles.ts'
import ReferencePreview from '@/shared/ui/ReferencePreview.vue'

const { t, te, locale } = useI18n()
const { act: actOnNotice, current: currentNotice, dismiss: dismissNotice, say } = useShellNotice()

function localizedFailure(failure: TypedFailure): string {
  const message = failureMessage(failure)
  return t(message.key, message.params ?? {})
}

const {
  activeModule,
  cardQuestionAsked,
  cardQuestionTaken,
  documentPage,
  entryRestorePending,
  goHome,
  openProject,
  operatingScope,
  pendingSession,
  questionsAsked,
  route,
  routeBlocked,
  routeFailure,
  routeUnavailable: parsedRouteUnavailable,
  switchModule,
  switchScope,
  updateModuleState,
  workItemLink,
  writeRoute,
} = usePlatformNavigation(
  () => t('platform.route.notFound'),
  (part) =>
    say(
      t(part === 'state' ? 'platform.route.stateDropped' : 'platform.route.queryDropped'),
      'done',
    ),
)

// The destination an address names starts downloading before the module list settles.
watch(activeModule, prefetchModule, { immediate: true })

const { finderOpen, finderText, findText, requestsOpen, pendingRequestCount, openTarget } =
  useGlobalWorkActions(writeRoute, questionsAsked, cardQuestionAsked)
const mainContent = ref<HTMLElement | null>(null)
function focusMainContent() {
  mainContent.value?.focus()
}

const contextReady = computed(() =>
  contextState.value.status === 'ready' || contextState.value.status === 'degraded'
    ? contextState.value.payload
    : null,
)
// Every surface that names a project reads the same list the finder does.
provideProjectTitles(computed(() => contextReady.value?.projects ?? []))
const moduleStage = ref<InstanceType<typeof AppModuleStage> | null>(null)
// The card by the id a sender of alerts knows it by: the route has only its reference.
useAlertPresence(
  () => moduleStage.value?.openCardId ?? null,
  () => requestsOpen.value,
)
/** The open space's stream; null while no space is open, and the shell's connection speaks. */
const planningConnection = ref<PlanningConnectionState | null>('connecting')
const { contextState, loadContext } = usePlatformReadModels()

const {
  modules,
  moduleRegistrations,
  modulesAuthoritative,
  modulesSettled,
  modulesFailure,
  connectionState,
  refreshing,
  refreshAll,
} = usePlatformLiveFeed({
  say,
  loadContext,
  refreshSurface: async () => {
    await nextTick()
    if (!['empty', 'ready'].includes(contextState.value.status))
      throw new Error('Context refresh failed')
    await moduleStage.value?.refresh()
  },
  text: {
    failure: localizedFailure,
    refreshed: () => t('refresh.done'),
  },
})

const {
  activeManifest,
  moduleTitle,
  routeFailure: liveRouteFailure,
  routeUnavailable,
} = useModuleRouteAuthority({
  modules,
  modulesAuthoritative,
  modulesSettled,
  parsedUnavailable: parsedRouteUnavailable,
  registrations: moduleRegistrations,
  route,
  te,
  translate: t,
})
const { availableProjectResources, selectedResourceRef, selectResource } = useProjectResources({
  activeManifest,
  contextReady,
  modulesAuthoritative,
  refused: () => {
    say(t('platform.route.invalid'), 'refused')
  },
  route,
  writeRoute,
})
const routeRecoveryFailure = computed(
  () => routeFailure.value || (modulesAuthoritative.value ? '' : modulesFailure.value),
)
// A space's stream carries the live-work frame, so the shell opens its own only without one,
// and only once it knows: the space a project shows is known once the context has been read.
const { connection: liveConnection } = useLiveWorkFeed({
  shell: () =>
    documentPage.value === null &&
    modulesSettled.value &&
    !entryRestorePending.value &&
    contextState.value.status !== 'loading',
  spaceStream: () =>
    activeModule.value === 'planning' &&
    planningConnection.value !== null &&
    workItemLink.value === null &&
    !routeRecoveryFailure.value &&
    !routeUnavailable.value &&
    Boolean(modulesAuthoritative.value && activeManifest.value),
})
const { current: liveShown, target: liveTarget } = useLiveWorkNav(route, contextReady)

const displayedConnection = computed(() => {
  if (activeModule.value === 'planning' && operatingScope.value.kind === 'project')
    return planningConnection.value ?? liveConnection.value ?? connectionState.value
  return liveConnection.value === 'reconnecting' ? 'reconnecting' : connectionState.value
})
/**
 * The address names no section at all. The shell then says so in the context bar
 * and marks no section current: the rail and the bar used to name «Work» over a
 * page that said nothing was there.
 */
const routeLost = computed(
  () => Boolean(routeFailure.value) || routeUnavailable.value?.reason === 'unknown-module',
)
const currentModule = computed(() =>
  routeLost.value || workItemLink.value !== null ? null : activeModule.value,
)
const contextTitle = computed(() => {
  if (workItemLink.value !== null) return t('workItemLink.contextTitle')
  return routeLost.value ? t('platform.route.lostTitle') : moduleTitle.value
})
// A state the module's manifest does not admit is dropped, not shown as a
// blocked module: the address keeps the module and scope, and says so once.
watch(liveRouteFailure, (failure) => {
  if (!failure) return
  updateModuleState({})
  say(t('platform.route.stateDropped'), 'done')
})
const primaryWriteScopeId = computed(() =>
  contextReady.value?.primary.is_writable === true
    ? contextReady.value.primary.data_scope_id
    : null,
)

function openEntity(entity?: EntityRef) {
  writeRoute({
    module_id: activeModule.value,
    scope: operatingScope.value,
    ...(entity ? { entity } : {}),
    state: route.value.state,
  })
}

const { openSession, sessionContext } = useSessionOpening({
  contextReady,
  moduleRegistrations,
  modulesSettled,
  pendingSession,
  refused: () => {
    say(localizedFailure({ code: 'request_failed', status: null, retryable: true }), 'refused')
  },
  writeRoute,
})
const { documentView, openDocument } = useAppDocuments([
  activeModule,
  () => JSON.stringify(route.value.entity),
  requestsOpen,
])
// What a path written in free text can do from here: see the composable.
useDocumentOpening(say, openDocument)
provideOpenNotice(say)
// References written in free text, anywhere in the shell: see the composable.
useAppReferenceLinks({
  projects: () => contextReady.value?.projects ?? [],
  primaryScope: () => contextReady.value?.primary.data_scope_id,
  openTarget,
  openSession: (id) => void openSession(id),
  say,
})
function selectLocale(requested: string) {
  const value = requested === 'ru' ? 'ru' : 'en'
  locale.value = value
  localStorage.setItem('valkama-locale', value)
  document.documentElement.lang = value
}

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
    v-if="documentPage === null"
    class="skip-link"
    href="#main-content"
    @click.prevent="focusMainContent"
    >{{ t('accessibility.skipToContent') }}</a
  >
  <div
    v-if="documentPage === null"
    class="app-shell"
  >
    <AppNav
      :modules="modules"
      :active="currentModule"
      :connection="displayedConnection"
      :refreshing="refreshing"
      :pending-request-count="pendingRequestCount"
      :live-shown="liveShown"
      :live-target="liveTarget"
      @find="finderOpen = true"
      @go="(next) => writeRoute(next)"
      @requests="requestsOpen = true"
      @navigate="switchModule"
      @prefetch="prefetchModule"
      @home="goHome"
      @refresh="refreshAll"
    />

    <div class="app-main">
      <AppContextBar
        :title="contextTitle"
        :scope="operatingScope"
        :resource-ref="selectedResourceRef"
        :resources="availableProjectResources"
        :projects="contextReady?.projects ?? []"
        @scope="switchScope"
        @resource="selectResource"
      />

      <div
        id="main-content"
        ref="mainContent"
        class="module-stage"
        tabindex="-1"
      >
        <WorkItemLinkPanel
          v-if="workItemLink !== null"
          :text="workItemLink"
          @find="finderOpen = true"
          @found="(next) => writeRoute(next, 'replace')"
          @go="writeRoute"
          @home="goHome"
        />
        <AppRouteRecovery
          v-else-if="
            entryRestorePending || !modulesSettled || routeRecoveryFailure || routeUnavailable
          "
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
          :question-asked="cardQuestionAsked"
          :module-title="moduleTitle"
          :scope="operatingScope"
          :primary-write-scope-id="primaryWriteScopeId"
          :context="contextReady"
          :route="route"
          :state-bytes="activeManifest.state_schema.max_bytes"
          :locale="locale"
          @connection="(state) => (planningConnection = state)"
          @entity="openEntity"
          @find="findText"
          @notice="(message) => say(message, 'refused')"
          @open-project="openProject"
          @question-taken="cardQuestionTaken"
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
    </div>
  </div>
  <GlobalWorkFinder
    v-if="documentPage === null"
    :open="finderOpen"
    :text="finderText"
    :projects="contextReady?.projects ?? []"
    @close="finderOpen = false"
    @select="openTarget"
  />
  <AppRequestsHub
    v-if="documentPage === null"
    :open="requestsOpen"
    @close="requestsOpen = false"
    @select="openTarget"
    @count="(count) => (pendingRequestCount = count)"
  />
  <DocumentDrawer
    v-if="documentPage === null"
    :view="documentView"
  />
  <AppDocumentPage
    v-else
    :address="documentPage"
  />
  <!-- Beside the overlays rather than in the workspace, whose containment would hold it under
       them: a press inside a card or a dialog says what it did here. -->
  <AppNotice
    :notice="currentNotice"
    @act="actOnNotice"
    @dismiss="dismissNotice"
  />
  <ReferencePreview />
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

  /* A forced palette clears the ground that parted the panel from the chrome, so its edge is
     drawn in the palette's ink. A border, because nothing laid out inside can cover it: an
     outline drawn inside lay under the board's own opaque, positioned ground and was lost. */
  @media (forced-colors: active) {
    border: 1px solid currentcolor;
  }
}

/* Focus lands here when a press named no control to go back to. A ring around the whole
   workspace says nothing about where the reader is. */
.module-stage:focus-visible {
  outline: none;
}
</style>
