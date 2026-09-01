<script setup lang="ts">
/**
 * Several projects read together, with the parts that must not be merged apart.
 *
 * The portfolio used to fetch a whole dashboard per project and render a strip
 * of lane counts from each — N requests for one row apiece, and nothing about
 * what distinguished the projects. A cross-project mode whose projects all look
 * alike is a list.
 *
 * The combining happens on the server, because the rule for it is coverage and
 * a second implementation of coverage is a second answer. What this renders is
 * already combined, already weighted, and already says which backend answered
 * where — which is what makes a portfolio of differently-configured projects
 * readable rather than merely summed.
 *
 * The one thing shown per project and never added is the lane strip: two spaces
 * may declare different lanes, and a column meaning `review` in one and nothing
 * in the other is a column nobody can read.
 */
import { computed, onMounted, ref } from 'vue'
import type { Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'

import {
  fetchAnalyticsPortfolio,
  spaceAnalyticsHref,
} from '@/entities/analytics/api/analyticsApi.ts'
import type {
  AnalyticsPortfolio,
  AnalyticsPortfolioProject,
} from '@/entities/analytics/api/analyticsApi.ts'

import { uiEmpty, uiReady } from '@/shared/api/platformUiState.ts'
import {
  beginResource,
  createResource,
  rejectResource,
  resolveResource,
} from '@/shared/api/resourceState.ts'
import type { ResourceState } from '@/shared/api/resourceState.ts'
import { resourceUiState } from '@/shared/api/resourceUiState.ts'
import type { Observed } from '@/shared/api/resourceUiState.ts'
import { failureMessage, typedFailure } from '@/shared/api/typedFailure.ts'
import PlatformStatePanel from '@/shared/ui/PlatformStatePanel.vue'
import SectionHeading from '@/shared/ui/SectionHeading.vue'
import VButton from '@/shared/ui/VButton.vue'
import VIcon from '@/shared/ui/VIcon.vue'

defineProps<{ dataScopeId: string | null }>()

const { t, n } = useI18n()

interface PortfolioObserved extends Observed<true> {
  value: AnalyticsPortfolio
}

const resource = ref(createResource<PortfolioObserved>()) as Ref<ResourceState<PortfolioObserved>>
const state = computed(() =>
  resourceUiState(resource.value, {
    failureReason: (failure) => {
      const message = failureMessage(failure)
      return t(message.key, message.params ?? {})
    },
  }),
)
const reading = computed(() => resource.value.data?.value ?? null)
const retryable = computed(() => resource.value.failure?.retryable ?? false)
/** Absent means idle; `aria-busy="false"` would make an unnecessary claim. */
const refreshBusyMark = computed(
  () => (state.value.status === 'degraded' && state.value.reason === undefined) || undefined,
)

/** A count, or the dash that is the honest rendering of an unknown. */
function figure(value: number | null): string {
  return value === null ? '—' : n(value)
}

/** Whole hours are what a portfolio is read at; a cycle in seconds is noise. */
function hours(seconds: number | null): string {
  return seconds === null
    ? '—'
    : t('platform.analytics.hours', { hours: Math.round(seconds / 3600) })
}

/** Who answered, or that nobody did — never an empty cell that reads as none. */
function backends(adapters: string[]): string {
  return adapters.length > 0 ? adapters.join(' · ') : t('platform.analytics.noBackend')
}

async function load() {
  const key = 'analytics:portfolio'
  resource.value = beginResource(resource.value, key)
  const generation = resource.value.generation
  try {
    const payload = await fetchAnalyticsPortfolio()
    resource.value = resolveResource(resource.value, generation, key, {
      at: new Date().toISOString(),
      state:
        payload.totals.projects === 0
          ? uiEmpty('platform.analytics.noMappedProjects')
          : uiReady(true),
      value: payload,
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

function openProject(row: AnalyticsPortfolioProject, dataScopeId: string): string {
  return spaceAnalyticsHref(row.project_id, dataScopeId, row.space_key)
}

/**
 * The combined figures, named here rather than repeated as five near-identical
 * blocks of markup. They are the same kind of thing — a label and a quantity —
 * and writing them out five times is how one of them quietly stops matching.
 */
const combined = computed(() => {
  const totals = reading.value?.totals
  if (!totals) return []
  return [
    { label: t('platform.analytics.inventory'), value: figure(totals.inventory) },
    { label: t('dashboard.attempts'), value: figure(totals.attempts) },
    { label: t('dashboard.delivered'), value: figure(totals.delivered) },
    { label: t('dashboard.tokens'), value: figure(totals.tokens) },
    { label: t('platform.analytics.cycle'), value: hours(totals.cycle_seconds) },
  ]
})

/** One project's attempts, cost and backend as the line a reader scans. */
function attemptLine(row: AnalyticsPortfolioProject): string {
  const coverage = t(`usage.coverageState.${row.tokens_coverage}`)
  return [
    `${t('dashboard.attempts')}: ${figure(row.attempts)}`,
    `${t('dashboard.delivered')}: ${figure(row.delivered)}`,
    `${t('dashboard.tokens')}: ${figure(row.tokens)} (${coverage})`,
    backends(row.adapters),
  ].join(' · ')
}

onMounted(load)
</script>

<template>
  <section class="portfolio-head">
    <div>
      <SectionHeading>{{ t('platform.planning.portfolio') }}</SectionHeading>
      <p class="portfolio-intro">{{ t('platform.analytics.portfolioIntro') }}</p>
    </div>
    <span
      v-if="reading"
      class="portfolio-count"
      >{{ t('platform.planning.projectCount', { count: reading.totals.projects }) }}</span
    >
  </section>

  <PlatformStatePanel
    :state="state"
    :retryable="retryable"
    @retry="load"
  >
    <template #default>
      <div
        v-if="reading"
        class="portfolio-reading"
        :aria-busy="refreshBusyMark"
      >
        <div
          v-if="state.status === 'degraded' && state.reason && retryable"
          class="portfolio-recovery"
        >
          <VButton @click="load">{{ t('platform.actions.retry') }}</VButton>
        </div>
        <section
          class="portfolio-total"
          :aria-label="t('platform.analytics.combined')"
        >
          <dl class="total-strip">
            <div
              v-for="entry in combined"
              :key="entry.label"
              class="total-cell"
            >
              <dt class="total-label">{{ entry.label }}</dt>
              <dd class="total-figure">{{ entry.value }}</dd>
            </div>
          </dl>
          <p class="portfolio-note">
            {{
              t('platform.analytics.combinedCoverage', {
                tokens: t(`usage.coverageState.${reading.totals.tokens_coverage}`),
                observed: reading.totals.cycle_observed,
              })
            }}
          </p>
          <p class="portfolio-note">
            {{ t('platform.analytics.backendsAnswered') }}:
            {{ backends(reading.totals.adapters) }}
          </p>
          <p class="portfolio-note">{{ t('platform.analytics.notCombined') }}</p>
          <p
            v-if="reading.truncated"
            class="portfolio-note"
          >
            {{ t('platform.analytics.portfolioTruncated') }}
          </p>
        </section>

        <section
          v-for="row in reading.projects"
          :key="row.project_id"
          class="portfolio-project"
        >
          <header class="project-head">
            <div>
              <strong class="project-name">{{ row.space_name }}</strong>
              <span class="project-key">{{ row.space_key }}</span>
            </div>
            <RouterLink
              v-if="dataScopeId"
              v-slot="{ navigate }"
              :to="openProject(row, dataScopeId)"
              custom
            >
              <VButton
                class="project-open"
                @click="navigate"
              >
                {{ t('platform.analytics.openProject')
                }}<VIcon
                  name="chevron-right"
                  :size="15"
                />
              </VButton>
            </RouterLink>
            <VButton
              v-else
              class="project-open"
              disabled
            >
              {{ t('platform.analytics.openProject')
              }}<VIcon
                name="chevron-right"
                :size="15"
              />
            </VButton>
          </header>
          <ul class="lane-strip">
            <li
              v-for="lane in row.states"
              :key="lane.key"
              class="lane"
            >
              <span class="lane-name">{{ lane.key }}</span
              ><b class="lane-count">{{ lane.items }}</b>
            </li>
            <li class="lane lane-total">
              <span class="lane-name">{{ t('platform.analytics.inventory') }}</span
              ><b class="lane-count">{{ row.inventory }}</b>
            </li>
          </ul>
          <p class="portfolio-note project-note">{{ attemptLine(row) }}</p>
        </section>
      </div>
    </template>
  </PlatformStatePanel>
</template>

<style scoped>
.portfolio-head {
  display: flex;
  gap: var(--space-5);
  justify-content: space-between;
  align-items: flex-start;
  padding: var(--space-1) 0 var(--space-2);
}

.portfolio-intro {
  max-width: 68ch;
  margin: var(--space-2) 0 0;
  color: var(--color-text-muted);
  font: var(--font-note);
}

.portfolio-count {
  color: var(--color-text-muted);
  font: var(--font-detail);
}

.portfolio-reading {
  display: grid;
  gap: var(--space-4);
  min-width: 0;
}

.portfolio-recovery {
  display: flex;
  justify-content: flex-end;
}

.portfolio-total {
  display: grid;
  gap: var(--space-2);
  min-width: 0;
}

.total-strip {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3) var(--space-6);
  margin: 0;
}

.total-cell {
  display: grid;
  gap: var(--space-hair);
}

.total-label {
  color: var(--color-text-muted);
  font: var(--font-detail);
}

.total-figure {
  margin: 0;
  color: var(--color-text);
  font: var(--font-emphasis);
}

.portfolio-note {
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-detail);
  overflow-wrap: anywhere;
}

.portfolio-project {
  background: var(--color-surface);
  overflow: hidden;
  border-radius: var(--radius-card);
}

.project-head {
  display: flex;
  gap: var(--space-4);
  justify-content: space-between;
  align-items: center;
  padding: var(--space-3) var(--space-4);
  border-bottom: 1px solid var(--color-rule);
}

.project-name {
  font: var(--font-emphasis);
}

.project-key {
  display: block;
  margin-top: var(--space-1);
  color: var(--color-text-muted);
  font: var(--font-detail);
}

.project-note {
  padding: 0 var(--space-4) var(--space-4);
}

.lane-strip {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  padding: var(--space-4);
  margin: 0;
  list-style: none;
}

.lane {
  display: inline-flex;
  gap: var(--space-2);
  align-items: baseline;
  padding: var(--space-2) var(--space-3);
  background: var(--color-surface-muted);
  border-radius: var(--radius-control);
}

.lane-name {
  color: var(--color-text-muted);
  font: var(--font-detail);
}

.lane-count {
  font: var(--font-context);
}

.lane-total {
  background: var(--color-surface-active);
}

@container workspace (width <= 556px) {
  .project-head {
    flex-direction: column;
    align-items: stretch;
  }

  .project-open {
    width: 100%;
  }
}
</style>
