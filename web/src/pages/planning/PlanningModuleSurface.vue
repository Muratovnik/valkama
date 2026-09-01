<script setup lang="ts">
/**
 * The Planning module's own surface: which space is open, and what is in it.
 *
 * Two boundaries meet here and neither owns the other. The Kernel answers which
 * project this is, which resource it is bound to, and who may write — that is
 * scope and ownership. Planning's own boundary answers what is in the space.
 * Keeping the second out of the Kernel projection is what let Kanban stop being
 * the model: `/api/planning` returns the workflow, the items and the links, and
 * each view projects what it needs from that one answer.
 *
 * Which item is open is in the route, not here. That is what makes an item
 * linkable: a reload comes back to it, Back closes it, and a bookmark is a work
 * item rather than a space. It reads the item out of the same `work-item` entity
 * the Kernel encodes — `{space_ref, reference}` — so there is one spelling of the
 * identity and the route carries it.
 *
 * How deep the operator went to get there stays local. A trail is navigation
 * history, not identity, and the browser already owns history.
 */
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import PlanningPortfolio from '@/pages/planning/PlanningPortfolio.vue'
import PlanningWorkspace from '@/pages/planning/PlanningWorkspace.vue'
import type { PlanningViewMode } from '@/pages/planning/PlanningWorkspace.vue'

import WorkItemInspector from '@/widgets/work-item-inspector/components/WorkItemInspector.vue'

import WorkItemComposer from '@/features/work-item-compose/WorkItemComposer.vue'

import { CutoverPendingError, fetchPlanning, transitionWorkItem } from '@/shared/api/planningApi.ts'
import type { PlanningReadModel } from '@/shared/api/planningModel.ts'
import type { PlatformContextReady, PlatformRegistryReady } from '@/shared/api/platformApiTypes.ts'
import type { EntityRef } from '@/shared/api/platformEntityRef.ts'
import { fetchPlanningWorkItem, fetchPlatformPlanning } from '@/shared/api/platformPlanningApi.ts'
import {
  planningSpaceEntity,
  planningWorkItemEntity,
  resolvePlanningRouteSelection,
} from '@/shared/api/platformPlanningRefs.ts'
import type { PlanningSpaceRef } from '@/shared/api/platformPlanningRefs.ts'
import type { PlatformPlanningReady } from '@/shared/api/platformPlanningTypes.ts'
import type { PlatformRelation } from '@/shared/api/platformRelations.ts'
import type { OperatingScope, PlatformRoute } from '@/shared/api/platformRoute.ts'
import { uiError, uiLoading, uiUnavailable } from '@/shared/api/platformUiState.ts'
import type { PlatformUiState } from '@/shared/api/platformUiState.ts'
import type { PlanningSpaceEntityRef } from '@/shared/types/reference.ts'
import PlatformStatePanel from '@/shared/ui/PlatformStatePanel.vue'

const props = defineProps<{
  context: PlatformContextReady | null
  primaryWriteScopeId: string | null
  registry: PlatformRegistryReady | null
  route: PlatformRoute
  scope: OperatingScope
}>()

const emit = defineEmits<{
  'entity': [entity?: EntityRef]
  'notice': [message: string]
  'open-project': [projectId: string]
  'open-session': [sessionId: string, clientFamily: string]
  'state': [state: Record<string, string | number | boolean>]
}>()

const { t } = useI18n()

const mappedResourceRefs = computed<EntityRef[]>(() => {
  const scope = props.scope
  if (scope.kind !== 'project') return []
  const project = props.context?.projects.find(
    (item) => item.project_id === scope.project_ref.project_id,
  )
  return (project?.resources ?? [])
    .filter((resource) => resource.state === 'mapped')
    .map((resource) => resource.resource_ref)
})

const routeSelection = computed(() =>
  resolvePlanningRouteSelection(
    props.route.entity,
    mappedResourceRefs.value,
    props.scope.kind === 'project',
  ),
)

/** The Kernel resource this project binds, which is what write ownership keys on. */
const boundSpace = computed<PlanningSpaceRef | undefined>(() =>
  routeSelection.value.status === 'ready' ? routeSelection.value.space_ref : undefined,
)

/** The canonical Kernel identity whose project binding owns local source access. */
const boundSpaceResourceRef = computed<PlanningSpaceEntityRef | undefined>(() => {
  const space = boundSpace.value
  return space === undefined ? undefined : (planningSpaceEntity(space) as PlanningSpaceEntityRef)
})

const projectId = computed(() =>
  props.scope.kind === 'project' ? props.scope.project_ref.project_id : undefined,
)

/**
 * The same answer as a string, for a child that takes one.
 *
 * The inspector's Memory section searches a project's own knowledge, and a
 * global scope has no project to search: an empty string is what it renders as
 * "open this inside its project", where `undefined` would be a missing prop.
 */
const inspectorProjectId = computed(() => projectId.value ?? '')

const view = computed<PlanningViewMode>(() => {
  const value = props.route.state?.view
  return value === 'graph' || value === 'list' ? value : 'kanban'
})

/** The Kernel's directory of projects and their spaces, which global scope shows. */
const portfolio = ref<PlatformUiState<PlatformPlanningReady>>(uiLoading())
/**
 * Planning's own read model, held beside its status rather than inside one.
 *
 * `PlatformUiState` bounds an adapter payload at 256KB, which is the right rule
 * for a state an adapter supplies and the wrong container for a first-party read
 * model that legitimately carries two thousand items. The status drives the
 * panel; the model is what the views read.
 */
const model = ref<PlanningReadModel | null>(null)
const stale = ref(false)
const planning = ref<PlatformUiState>(uiLoading())
const version = ref(0)

/** Which item the route names, and how deep the operator went to get there. */
const open = computed(() =>
  routeSelection.value.status === 'ready'
    ? (routeSelection.value.work_item_ref?.reference ?? null)
    : null,
)

/**
 * A reference is unique only inside its planning space. Key the inspector by
 * the complete route identity so an equally named item in an attached store
 * cannot inherit the first item's selected panel, draft, error, or result.
 */
const openIdentity = computed(() => {
  const space = boundSpace.value
  const reference = open.value
  return space === undefined || reference === null
    ? ''
    : `${space.data_scope_id}:${space.space_key}:${reference}`
})
const trail = ref<string[]>([])
const composerOpen = ref(false)

let portfolioSerial = 0
let planningSerial = 0

async function loadPortfolio() {
  const mine = ++portfolioSerial
  portfolio.value = uiLoading()
  try {
    const payload = await fetchPlatformPlanning(props.scope)
    if (mine === portfolioSerial) portfolio.value = payload.state
  } catch (error) {
    if (mine !== portfolioSerial) return
    portfolio.value = uiError(error instanceof Error ? error.message : String(error))
  }
}

async function loadPlanning() {
  const project = projectId.value
  if (routeSelection.value.status === 'unavailable' || project === undefined) {
    model.value = null
    planning.value = uiUnavailable(t('platform.planning.bindingRequired'))
    return
  }
  const mine = ++planningSerial
  // A refresh keeps the drawn space up. Blanking it here is what made the tab
  // look like it reloads forever while agents write.
  if (model.value === null) planning.value = uiLoading()
  else stale.value = true
  try {
    const next = await fetchPlanning({ project })
    if (mine !== planningSerial) return
    version.value += 1
    stale.value = false
    if (next.planning_space === null) {
      model.value = null
      planning.value = uiUnavailable(t('workItem.noSpace'))
      return
    }
    model.value = next
  } catch (error) {
    if (mine !== planningSerial) return
    stale.value = false
    // A store whose cutover has not run is not an error: it is a store that
    // still answers on the Board domain, and it says which command fixes that.
    if (error instanceof CutoverPendingError) {
      model.value = null
      planning.value = uiUnavailable(t('workItem.cutoverPending'))
      return
    }
    const reason = error instanceof Error ? error.message : String(error)
    if (model.value === null) planning.value = uiError(reason)
    else emit('notice', reason)
  }
}

/**
 * What a read of this space depends on, as one value that can be compared.
 *
 * A string, not an array. A watcher whose getter returns a fresh array compares
 * two different references every time, so it fires on any dependency touch
 * rather than on a change — which re-read the whole space on every item opened
 * and cleared the trail with it, so Back was never offered.
 *
 * The open item is deliberately not in here: it changes the route and not what
 * the space would answer.
 */
const readKey = computed(() =>
  JSON.stringify([props.scope, boundSpace.value, props.context?.projects]),
)

watch(
  readKey,
  () => {
    trail.value = []
    composerOpen.value = false
    if (props.scope.kind === 'global') void loadPortfolio()
    else void loadPlanning()
  },
  { immediate: true },
)

const writable = computed(
  () =>
    props.scope.kind === 'project' &&
    boundSpace.value !== undefined &&
    props.primaryWriteScopeId === boundSpace.value.data_scope_id,
)

const workflow = computed(() => model.value?.workflow ?? null)

/**
 * The Kernel half of the open item: what it points at outside Valkama.
 *
 * Planning's own read says what the item is; only the Kernel can say what is
 * attached to it, because attaching is authorized against the project binding
 * and the registry rather than against the space. The two halves stay two
 * reads for that reason, and the inspector is handed the second one.
 *
 * A failed read leaves the section showing the links between work items alone.
 * An empty relation list would read as "nothing attached", which is a different
 * claim from "could not ask".
 */
const relations = ref<readonly PlatformRelation[] | null>(null)
let relationsSerial = 0

async function loadRelations() {
  const space = boundSpace.value
  const reference = open.value
  const scope = props.scope
  if (space === undefined || reference === null || scope.kind !== 'project') {
    relations.value = null
    return
  }
  const mine = ++relationsSerial
  try {
    const payload = await fetchPlanningWorkItem(scope, { space_ref: space, reference })
    if (mine !== relationsSerial) return
    relations.value =
      payload.state.status === 'ready' ? payload.state.payload.relations.relations : null
  } catch (error) {
    if (mine !== relationsSerial) return
    relations.value = null
    emit('notice', error instanceof Error ? error.message : String(error))
  }
}

watch([open, version], loadRelations, { immediate: true })

/**
 * The Kernel prop, present exactly while every part of it is known: the project
 * that answers for the item, the space it is bound to, and a relation read that
 * came back.
 */
const kernel = computed(() => {
  const space = boundSpace.value
  const reference = open.value
  const attached = relations.value
  if (space === undefined || reference === null || attached === null) return null
  return {
    invocationScope: props.scope,
    registry: props.registry,
    relations: attached,
    viewScope: props.scope,
    workItemRef: { space_ref: space, reference },
  }
})

/** True once the operator reached this item from another one. */
const canGoBack = computed(() => trail.value.length > 0)

/** Route to one item of the bound space, or back to the space itself. */
function show(reference: string | null) {
  const space = boundSpace.value
  if (space === undefined) return
  emit(
    'entity',
    reference === null
      ? planningSpaceEntity(space)
      : planningWorkItemEntity({ space_ref: space, reference }),
  )
}

function openItem(reference: string, related = false) {
  if (related && open.value !== null && open.value !== reference)
    trail.value = [...trail.value, open.value]
  show(reference)
}

function closeItem() {
  trail.value = []
  show(null)
}

function goBack() {
  const previous = trail.value.at(-1)
  if (previous === undefined) return
  trail.value = trail.value.slice(0, -1)
  show(previous)
}

function setView(mode: PlanningViewMode) {
  emit('state', { ...props.route.state, view: mode })
}

/**
 * A drag across columns is a transition, and the workflow decides whether it is
 * allowed. A refused move is reported and the space re-read, so the tile snaps
 * back to where the store still says it is rather than lying about the drop.
 */
async function moveItem(reference: string, stateKey: string) {
  if (!writable.value) {
    emit('notice', t('platform.coreWrites.primaryOwnerRequired'))
    return
  }
  try {
    await transitionWorkItem({ id: reference, state: stateKey })
  } catch (error) {
    emit('notice', error instanceof Error ? error.message : String(error))
  }
  await loadPlanning()
}

function itemCreated(reference: string) {
  composerOpen.value = false
  void loadPlanning()
  show(reference)
}
</script>

<template>
  <main
    v-if="scope.kind === 'global'"
    class="planning-frame"
    tabindex="-1"
    data-scroll-owner="planning-portfolio"
    :aria-label="t('platform.modules.planning')"
  >
    <div class="planning-frame-content">
      <PlatformStatePanel
        :state="portfolio"
        :empty-description="t('platform.planning.noSpacesDetail')"
        @retry="loadPortfolio"
      >
        <template #default="{ payload }">
          <PlanningPortfolio
            :projects="payload.projects"
            @open-project="(id) => emit('open-project', id)"
          />
        </template>
      </PlatformStatePanel>
    </div>
  </main>

  <div
    v-else-if="model"
    class="planning-workspace-shell"
  >
    <PlanningWorkspace
      :model="model"
      :stale="stale"
      :version="version"
      :view="view"
      :writable="writable"
      @create="composerOpen = true"
      @open="(reference) => openItem(reference)"
      @transition="moveItem"
      @view="setView"
    />

    <WorkItemInspector
      v-if="open && boundSpaceResourceRef"
      :key="openIdentity"
      :reference="open"
      :resource-ref="boundSpaceResourceRef"
      :project-id="inspectorProjectId"
      :can-go-back="canGoBack"
      :refresh-token="version"
      :workflow="workflow"
      :writable="writable"
      :kernel="kernel"
      @back="goBack"
      @changed="loadPlanning"
      @close="closeItem"
      @open="(reference) => openItem(reference, true)"
      @session="(id, family) => emit('open-session', id, family)"
    />
  </div>
  <main
    v-else
    class="planning-frame"
    tabindex="-1"
    data-scroll-owner="planning-state"
    :aria-label="t('platform.modules.planning')"
  >
    <div class="planning-frame-content">
      <PlatformStatePanel
        :state="planning"
        @retry="loadPlanning"
      />
    </div>
  </main>

  <WorkItemComposer
    v-if="model?.planning_space"
    :key="`${boundSpace?.data_scope_id ?? ''}:${boundSpace?.space_key ?? ''}`"
    :open="composerOpen"
    :space="model.planning_space.planning_space_id"
    @close="composerOpen = false"
    @created="itemCreated"
  />
</template>

<style scoped>
.planning-frame {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  color: var(--color-text);
  background: var(--color-canvas);
  overflow-y: auto;
  overscroll-behavior: contain;
}

.planning-frame-content {
  width: min(var(--size-module-column), 100%);
  min-height: 100%;
  padding: var(--space-6) var(--size-page-gutter) var(--space-12);
  margin: 0 auto;
}

/* Planning and its inspector share the workspace they were actually given.
   `ResizableInspector` measures this row, so the navigation rail no longer
   disappears from its width calculation and the work surface always retains
   a useful minimum beside the panel. */
.planning-workspace-shell {
  position: relative;
  display: flex;
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}
</style>
