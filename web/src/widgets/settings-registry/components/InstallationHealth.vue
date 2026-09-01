<script setup lang="ts">
/**
 * The installation report, presented for an operator instead of dumped as CLI output.
 *
 * The server owns every check and its stable presentation code. This component
 * keeps the causal level order, puts actionable findings first, and leaves raw
 * paths and backend prose behind an explicit technical-details disclosure.
 */
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { fetchDoctorReport } from '@/shared/api/doctorApi.ts'
import type {
  DoctorCheck,
  DoctorLevel,
  DoctorReport,
  DoctorStatus,
} from '@/shared/api/doctorApi.ts'
import { uiDegraded, uiError, uiLoading, uiReady } from '@/shared/api/platformUiState.ts'
import type { PlatformUiState } from '@/shared/api/platformUiState.ts'
import CountBadge from '@/shared/ui/CountBadge.vue'
import DataEmptyState from '@/shared/ui/DataEmptyState.vue'
import PlatformStatePanel from '@/shared/ui/PlatformStatePanel.vue'
import SectionHeading from '@/shared/ui/SectionHeading.vue'
import SemanticState from '@/shared/ui/SemanticState.vue'
import VButton from '@/shared/ui/VButton.vue'

const { locale, t, te } = useI18n()
const report = ref<DoctorReport | null>(null)
const loading = ref(false)
const failed = ref(false)
const ORDER: Record<DoctorStatus, number> = { fail: 0, warn: 1, unknown: 2, ok: 3 }
const PANEL_PAYLOAD = true as const

const levels = computed<readonly DoctorLevel[]>(() =>
  (report.value?.levels ?? []).map((level) => ({
    ...level,
    checks: [...level.checks].sort((left, right) => ORDER[left.status] - ORDER[right.status]),
  })),
)
const attentionLevels = computed(() =>
  levels.value
    .map((level) => ({
      ...level,
      checks: level.checks.filter((check) => check.status !== 'ok'),
    }))
    .filter((level) => level.checks.length),
)
const passedLevels = computed(() =>
  levels.value
    .map((level) => ({ ...level, checks: level.checks.filter((check) => check.status === 'ok') }))
    .filter((level) => level.checks.length),
)
const problems = computed(() =>
  attentionLevels.value.reduce((total, level) => total + level.checks.length, 0),
)
const passed = computed(() => report.value?.summary.ok ?? 0)
const recheckLabel = computed(() => (loading.value ? t('health.checking') : t('health.recheck')))
const resourceState = computed<PlatformUiState<true>>(() => {
  if (!report.value) return failed.value ? uiError('health.loadFailed') : uiLoading()
  const parsed = new Date(report.value.checked_at)
  const observedAt = Number.isNaN(parsed.valueOf())
    ? new Date(0).toISOString()
    : parsed.toISOString()
  if (failed.value) return uiDegraded(PANEL_PAYLOAD, observedAt, 'health.refreshFailed')
  return loading.value ? uiDegraded(PANEL_PAYLOAD, observedAt) : uiReady(PANEL_PAYLOAD)
})
const checkedAt = computed(() => {
  if (!report.value) return ''
  const parsed = new Date(report.value.checked_at)
  return Number.isNaN(parsed.valueOf())
    ? report.value.checked_at
    : new Intl.DateTimeFormat(locale.value, {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(parsed)
})

function tone(status: DoctorStatus): string {
  return {
    fail: 'unavailable',
    warn: 'degraded',
    ok: 'ready',
    unknown: 'not-observed',
  }[status]
}

function levelLabel(level: DoctorLevel): string {
  const key = `health.level.${level.id}`
  return te(key) ? t(key) : level.title
}

function finding(check: DoctorCheck, part: 'title' | 'detail' | 'fix'): string {
  const key = `health.finding.${check.presentation.code}.${part}`
  if (te(key)) return t(key, check.presentation.parameters)
  if (part === 'fix' && check.status === 'ok') return ''
  return t(`health.findingFallback.${part}`)
}

async function load() {
  if (loading.value) return
  loading.value = true
  failed.value = false
  try {
    report.value = await fetchDoctorReport()
  } catch {
    failed.value = true
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<template>
  <section
    class="installation-health"
    :aria-label="t('health.heading')"
  >
    <header class="health-head">
      <div>
        <SectionHeading as="h3">{{ t('health.heading') }}</SectionHeading>
        <p class="health-intro">{{ t('health.intro') }}</p>
      </div>
      <VButton
        :disabled="loading"
        @click="load"
      >
        {{ recheckLabel }}
      </VButton>
    </header>

    <PlatformStatePanel
      :state="resourceState"
      @retry="load"
    >
      <template #default>
        <section class="health-summary">
          <span class="health-summary-lead">
            <SemanticState
              dimension="integration-health"
              :state="tone(report?.status ?? 'unknown')"
              :label="t(`health.overall.${report?.status ?? 'unknown'}`)"
            />
            <span class="health-summary-counts">
              <span class="health-countline">
                <span>{{ t('settings.diagnostics.needsAttention') }}</span>
                <CountBadge
                  placement="inline"
                  :value="problems"
                />
              </span>
              <span class="health-countline">
                <span>{{ t('settings.diagnostics.passed') }}</span>
                <CountBadge
                  placement="inline"
                  :value="passed"
                />
              </span>
            </span>
          </span>
          <p class="health-checked">{{ t('health.lastChecked', { at: checkedAt }) }}</p>
        </section>

        <section class="health-attention">
          <header class="health-section-head">
            <span class="health-titleline">
              <SectionHeading as="h4">{{ t('health.attention') }}</SectionHeading>
              <CountBadge
                placement="inline"
                :value="problems"
              />
            </span>
          </header>
          <div
            v-if="attentionLevels.length"
            class="health-levels"
          >
            <section
              v-for="level in attentionLevels"
              :key="level.id"
              class="health-level"
            >
              <header class="health-level-head">
                <span class="health-titleline">
                  <SemanticState
                    class="health-level-state"
                    dimension="integration-health"
                    :state="tone(level.status)"
                    :label="levelLabel(level)"
                  />
                  <CountBadge
                    placement="inline"
                    :value="level.checks.length"
                  />
                </span>
              </header>
              <ul class="health-list">
                <li
                  v-for="check in level.checks"
                  :key="check.id"
                  class="health-finding"
                >
                  <SemanticState
                    class="health-finding-state"
                    dimension="integration-health"
                    :state="tone(check.status)"
                    :label="finding(check, 'title')"
                  />
                  <p class="health-detail">{{ finding(check, 'detail') }}</p>
                  <div
                    v-if="finding(check, 'fix')"
                    class="health-action"
                  >
                    <strong class="health-action-label">{{ t('health.action') }}</strong>
                    <span>{{ finding(check, 'fix') }}</span>
                  </div>
                  <details class="health-technical">
                    <summary class="health-technical-summary">{{ t('health.technical') }}</summary>
                    <dl class="health-technical-list">
                      <div class="health-technical-row">
                        <dt class="health-technical-term">{{ t('health.technicalCode') }}</dt>
                        <dd class="health-technical-value">{{ check.presentation.code }}</dd>
                      </div>
                      <div class="health-technical-row">
                        <dt class="health-technical-term">{{ t('health.technicalDetail') }}</dt>
                        <dd class="health-technical-value">{{ check.detail }}</dd>
                      </div>
                      <div
                        v-if="check.fix"
                        class="health-technical-row"
                      >
                        <dt class="health-technical-term">{{ t('health.technicalFix') }}</dt>
                        <dd class="health-technical-value">{{ check.fix }}</dd>
                      </div>
                    </dl>
                  </details>
                </li>
              </ul>
            </section>
          </div>
          <DataEmptyState
            v-else
            class="health-clear"
            :title="t('health.allGood')"
            :description="t('health.allGoodDetail')"
            compact
          />
        </section>

        <details
          v-if="passedLevels.length"
          class="health-passed"
        >
          <summary class="health-passed-summary">
            <span class="health-titleline">
              <strong>{{ t('settings.diagnostics.passed') }}</strong>
              <CountBadge
                placement="inline"
                :value="passed"
              />
            </span>
          </summary>
          <section
            v-for="level in passedLevels"
            :key="level.id"
            class="health-passed-level"
          >
            <h4 class="health-passed-title">{{ levelLabel(level) }}</h4>
            <ul class="health-passed-list">
              <li
                v-for="check in level.checks"
                :key="check.id"
                class="health-passed-row"
              >
                <SemanticState
                  dimension="integration-health"
                  state="ready"
                  :label="finding(check, 'title')"
                />
                <span class="health-passed-detail">{{ finding(check, 'detail') }}</span>
              </li>
            </ul>
          </section>
        </details>
      </template>
    </PlatformStatePanel>
  </section>
</template>

<style scoped src="./installation-health.css"></style>
