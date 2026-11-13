<script setup lang="ts">
/**
 * A Planning card opened over another module's page, which stays as it was under it.
 *
 * The address names the card as the board's does, as the work-item entity of the module's own
 * route, so Back closes it and a reload reopens it over the same view. The card is the board's
 * card: it reads its own record, and what it takes from its space — the states it may move to,
 * its parent, the labels a label is attached from — comes from one read of that space beside it,
 * into places the card already holds for them, as it does on the board.
 *
 * The page names no project for the card, so the card's project is the one that maps its space:
 * the page's own where it does, else the first that does, as a reference press found it. A space
 * no project maps opens nothing, as it would open nothing on the board.
 *
 * What only the board has stays there. A chain shown on the graph goes to the board's graph, and
 * a label pressed on the card, which narrows the board, narrows nothing here.
 */
import { computed, ref, shallowRef, useTemplateRef, watch } from 'vue'

import { useOpenCardModel } from '@/pages/planning/composables/useOpenCardModel.ts'
import { usePlanningCardTrail } from '@/pages/planning/composables/usePlanningCardTrail.ts'
import { withBranch, withChain } from '@/pages/planning/composables/usePlanningChainScope.ts'
import { usePlanningReferenceLinks } from '@/pages/planning/composables/usePlanningReferenceLinks.ts'
import PlanningCardDrawer from '@/pages/planning/PlanningCardDrawer.vue'

import WorkItemInspector from '@/widgets/work-item-inspector/components/WorkItemInspector.vue'

import { fetchPlanning } from '@/shared/api/planningApi.ts'
import type { WorkItemChain } from '@/shared/api/planningChainApi.ts'
import type { PlanningReadModel } from '@/shared/api/planningModel.ts'
import type { PlatformContextReady } from '@/shared/api/platformApiTypes.ts'
import type { EntityRef } from '@/shared/api/platformEntityRef.ts'
import {
  planningSpaceEntity,
  planningWorkItemEntity,
  resolvePlanningRouteSelection,
} from '@/shared/api/platformPlanningRefs.ts'
import type { OperatingScope, PlatformRoute } from '@/shared/api/platformRoute.ts'

const props = defineProps<{
  context: PlatformContextReady | null
  /** The module route's entity: a work item opens its card, anything else nothing. */
  entity: EntityRef | undefined
  primaryWriteScopeId: string | null
  scope: OperatingScope
  /** An address asked the open card to go to its waiting question. */
  questionAsked?: boolean
}>()

const emit = defineEmits<{
  /** Another card of the space, or none: the module's route names it. */
  'entity': [entity?: EntityRef]
  /** A place only the board has, such as a chain on its graph. */
  'go': [route: PlatformRoute]
  'question-taken': []
}>()

/** The card the entity names, in the project that maps its space. */
const bound = computed(() => {
  if (props.entity?.kind !== 'work-item') return null
  const projects = props.context?.projects ?? []
  const scope = props.scope
  const own = scope.kind === 'project' ? scope.project_ref.project_id : null
  const ordered = [
    ...projects.filter((project) => project.project_id === own),
    ...projects.filter((project) => project.project_id !== own),
  ]
  for (const project of ordered) {
    const mapped = project.resources
      .filter((resource) => resource.state === 'mapped')
      .map((resource) => resource.resource_ref)
    const selection = resolvePlanningRouteSelection(props.entity, mapped, true)
    if (selection.status === 'ready' && selection.work_item_ref)
      return { projectId: project.project_id, item: selection.work_item_ref }
  }
  return null
})

const open = computed(() => bound.value?.item.reference ?? null)
const space = computed(() => bound.value?.item.space_ref)
const resourceRef = computed(() => (space.value ? planningSpaceEntity(space.value) : undefined))
const identity = computed(() =>
  bound.value
    ? `${bound.value.projectId}:${bound.value.item.space_ref.data_scope_id}:${bound.value.item.space_ref.space_key}:${bound.value.item.reference}`
    : '',
)
/** Writes reach the primary store alone, as they do from the board. */
const writable = computed(
  () =>
    props.primaryWriteScopeId !== null && props.primaryWriteScopeId === space.value?.data_scope_id,
)

/** The card's space, read once per space it opens in and again after the card changed it. */
const model = shallowRef<PlanningReadModel | null>(null)
const reading = ref(false)
const spaceKey = computed(() =>
  bound.value ? JSON.stringify([bound.value.projectId, bound.value.item.space_ref]) : '',
)
let generation = 0
async function readSpace() {
  generation += 1
  const asked = generation
  const target = bound.value
  if (!target) {
    model.value = null
    reading.value = false
    return
  }
  reading.value = true
  try {
    const next = await fetchPlanning({ project: target.projectId, ...target.item.space_ref })
    if (asked === generation) model.value = next.planning_space ? next : null
  } catch {
    // The card reads its own record, and its writes do not wait for the space: without the
    // space it moves no state from its menu, and says so by offering none.
    if (asked === generation) model.value = null
  } finally {
    if (asked === generation) reading.value = false
  }
}
watch(
  spaceKey,
  () => {
    model.value = null
    void readSpace()
  },
  { immediate: true },
)

const { openRecord, parent } = useOpenCardModel(model, open)

function show(reference: string | null) {
  const at = space.value
  emit(
    'entity',
    reference === null || at === undefined
      ? undefined
      : planningWorkItemEntity({ space_ref: at, reference }),
  )
}
const { canGoBack, closeItem, goBack, openItem, reset, returning } = usePlanningCardTrail({
  open: () => open.value,
  show,
})
// Closed from outside the card, by Back or by another module: the walk ends with it.
watch(open, (reference) => {
  if (reference === null) reset()
})

const card = useTemplateRef<InstanceType<typeof WorkItemInspector>>('card')
const closePanel = () => card.value?.close()

// References to the card's space open in the card, through its departure and onto its trail.
usePlanningReferenceLinks(space, model, (reference) => {
  if (reference !== open.value) card.value?.openFrom(reference)
})

/** The chain on the board's graph, in the card's project: the overlay has no graph of its own. */
function showChain(chain: WorkItemChain, branch: string | null) {
  const target = bound.value
  if (!target) return
  const state = withChain(undefined, { reference: chain.root.reference, scope: chain.scope })
  emit('go', {
    module_id: 'planning',
    scope: { kind: 'project', project_ref: { project_id: target.projectId } },
    entity: planningSpaceEntity(target.item.space_ref),
    state: { ...withBranch(state, branch), view: 'graph' },
  })
}

/** The work item whose card is on show, by the id a sender of alerts knows it by. */
const selectedId = computed(() => openRecord.value?.work_item_id ?? null)
defineExpose({ selectedId })
</script>

<template>
  <PlanningCardDrawer
    :content-key="identity"
    :open="Boolean(open && resourceRef)"
    :label="openRecord?.title || open || ''"
    @close="closePanel"
  >
    <WorkItemInspector
      v-if="open && resourceRef && bound"
      ref="card"
      :key="identity"
      :reference="open"
      :resource-ref="resourceRef"
      :project-id="bound.projectId"
      :can-go-back="canGoBack"
      :return-to="returning"
      :refresh-token="0"
      :workflow="model?.workflow ?? null"
      :space-reading="reading"
      :writable="writable"
      :parent="parent"
      :kind="openRecord?.kind"
      :question-asked="questionAsked"
      @back="goBack"
      @changed="readSpace"
      @chain="showChain"
      @close="closeItem"
      @open="(reference, left) => openItem(reference, true, left)"
      @question-taken="emit('question-taken')"
    />
  </PlanningCardDrawer>
</template>
