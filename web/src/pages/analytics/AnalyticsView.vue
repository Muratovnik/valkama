<script setup lang="ts">
import { computed, defineAsyncComponent, ref, watch } from 'vue'
import type { Ref } from 'vue'
import { useI18n } from 'vue-i18n'

import AnalyticsPortfolio from '@/pages/analytics/components/AnalyticsPortfolio.vue'

import {
  fetchSpaceAnalytics,
  serializeAnalyticsFilters,
} from '@/entities/analytics/api/analyticsApi.ts'
import type { AnalyticsFilterInput } from '@/entities/analytics/api/analyticsApi.ts'

import type { PlatformContextReady } from '@/shared/api/platformApiTypes.ts'
import type { EntityRef } from '@/shared/api/platformEntityRef.ts'
import {
  planningSpaceRef,
  planningWorkItemEntity,
  planningWorkItemRef,
} from '@/shared/api/platformPlanningRefs.ts'
import type { PlanningSpaceRef } from '@/shared/api/platformPlanningRefs.ts'
import type { OperatingScope } from '@/shared/api/platformRoute.ts'
import { uiReady, uiUnavailable } from '@/shared/api/platformUiState.ts'
import {
  beginResource,
  cancelResource,
  createResource,
  rejectResource,
  resolveResource,
} from '@/shared/api/resourceState.ts'
import type { ResourceState } from '@/shared/api/resourceState.ts'
import { resourceUiState } from '@/shared/api/resourceUiState.ts'
import type { Observed } from '@/shared/api/resourceUiState.ts'
import { failureMessage, typedFailure } from '@/shared/api/typedFailure.ts'
import type { DashboardFilters, DashboardPayload } from '@/shared/types/analytics.ts'
import PlatformStatePanel from '@/shared/ui/PlatformStatePanel.vue'

const props = defineProps<{
  context: PlatformContextReady | null
  primaryWriteScopeId: string | null
  scope: OperatingScope
  entity?: EntityRef
}>()

const emit = defineEmits<{ open: [entity: EntityRef] }>()

// The echarts-heavy dashboard stays a lazy chunk (cards 233 and 253).
const AnalyticsDashboard = defineAsyncComponent(
  () => import('@/widgets/analytics-dashboard/components/AnalyticsDashboard.vue'),
)

const { t } = useI18n()

const spaceRef = computed(() => {
  let selected: PlanningSpaceRef | undefined
  try {
    selected = planningSpaceRef(props.entity) ?? planningWorkItemRef(props.entity)?.space_ref
  } catch {
    selected = undefined
  }
  return selected
})

// The name-only /api/dashboard read model serves the primary store; attached
// same-name boards keep a typed note instead of a wrong-store projection.
const spaceEligible = computed(
  () =>
    props.scope.kind === 'project' &&
    spaceRef.value !== undefined &&
    props.primaryWriteScopeId === spaceRef.value.data_scope_id,
)

/**
 * Analytics keeps its domain payload behind its own strict validator.
 *
 * The generic Platform state boundary deliberately refuses provider/token
 * payload keys, so its payload is only a rendering marker; the validated
 * analytics reading remains in the keyed resource beside it.
 */
interface AnalyticsObserved extends Observed<true> {
  value: DashboardPayload
}

const resource = ref(createResource<AnalyticsObserved>()) as Ref<ResourceState<AnalyticsObserved>>
const activeFilters = ref<AnalyticsFilterInput>({})
const state = computed(() =>
  resourceUiState(resource.value, {
    failureReason: (failure) => {
      const message = failureMessage(failure)
      return t(message.key, message.params ?? {})
    },
  }),
)
const payload = computed(() => resource.value.data?.value ?? null)
const retryable = computed(() => resource.value.failure?.retryable ?? false)

async function load(filters: AnalyticsFilterInput = {}) {
  const requestedSpace = spaceRef.value
  if (!spaceEligible.value || requestedSpace === undefined) return
  activeFilters.value = { ...filters }
  const filterKey = serializeAnalyticsFilters(filters).toString()
  const key = JSON.stringify([
    'analytics',
    requestedSpace.data_scope_id,
    requestedSpace.space_key,
    filterKey,
  ])
  resource.value = beginResource(resource.value, key)
  const generation = resource.value.generation
  try {
    const next = await fetchSpaceAnalytics(requestedSpace.space_key, filters)
    resource.value = resolveResource(resource.value, generation, key, {
      at: new Date().toISOString(),
      state: uiReady(true),
      value: next,
    })
  } catch (error) {
    resource.value = rejectResource(
      resource.value,
      generation,
      key,
      typedFailure(error, 'request_failed'),
    )
  }
}

// Which board this is, as a value rather than a fresh tuple: the parent hands
// down a new `spaceRef` object on every refresh, and a reference comparison
// read that as a different board — blanking the dashboard and refetching it
// while the operator was reading the charts.
const boardIdentity = computed(() =>
  spaceEligible.value && spaceRef.value
    ? `${spaceRef.value.data_scope_id}:${spaceRef.value.space_key}`
    : '',
)

watch(
  () => boardIdentity.value,
  (identity) => {
    activeFilters.value = {}
    if (!identity) {
      resource.value = cancelResource(resource.value)
      return
    }
    void load(activeFilters.value)
  },
  { immediate: true },
)

function applyFilters(filters: DashboardFilters) {
  void load(filters)
}

function openWorkItem(reference: string) {
  if (spaceRef.value !== undefined)
    emit('open', planningWorkItemEntity({ space_ref: spaceRef.value, reference }))
}
</script>

<template>
  <section
    class="analytics-view"
    :aria-label="t('platform.modules.analytics')"
  >
    <AnalyticsPortfolio
      v-if="scope.kind === 'global'"
      :data-scope-id="primaryWriteScopeId"
    />

    <template v-else>
      <PlatformStatePanel
        v-if="!spaceEligible"
        :state="uiUnavailable(t('platform.analytics.exactOnly'))"
        :retryable="false"
      />
      <AnalyticsDashboard
        v-else
        :open="true"
        :state="state"
        :payload="payload"
        :retryable="retryable"
        @filters="applyFilters"
        @open-work-item="openWorkItem"
        @retry="load(activeFilters)"
      />
    </template>
  </section>
</template>

<style scoped>
.analytics-view {
  display: grid;
  flex: 1 1 auto;
  gap: var(--space-4);
  align-content: start;
  min-width: 0;
  min-height: 0;
}

@container workspace (width <= 556px) {
  .analytics-view {
    padding-inline: var(--space-3);
  }
}
</style>
