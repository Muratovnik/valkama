<script setup lang="ts">
/**
 * How much work the item took, whole, at the head of its agents: the time on the clock and what
 * the agents spent together, the cost, the tokens processed anew, and in words what each of them
 * is, since a finger has no tooltip. Under them everything by kind, by model and by who did the
 * work — the session's own agent, a subagent by the class it was launched with, an adviser — with
 * the effort it ran at, then under which organization the work ran, and a way to the same work on
 * the Analytics page.
 *
 * A kind or a cost nobody reported says so and is never a zero. A read that failed says that it
 * failed, because not knowing is not the same as there being nothing, and offers to read again.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import UsageAccounts from '@/widgets/work-item-inspector/components/UsageAccounts.vue'
import UsageFacts from '@/widgets/work-item-inspector/components/UsageFacts.vue'
import { itemAnalyticsAddress } from '@/widgets/work-item-inspector/utils/analyticsAddress.ts'
import { injectInspectorUsage } from '@/widgets/work-item-inspector/utils/useInspectorRecord.ts'
import {
  isEstimated,
  saysAnything,
  tokensAnew,
  useUsageWords,
} from '@/widgets/work-item-inspector/utils/useUsageWords.ts'

import type { UsageRole, UsageTokens } from '@/shared/api/planningUsageApi.ts'
import ScreenLink from '@/shared/ui/ScreenLink.vue'
import { vTooltip } from '@/shared/ui/tooltipAnchors.ts'
import VButton from '@/shared/ui/VButton.vue'

const { t } = useI18n()
const { cost, count, figures: rowFigures, notes, span, time, tokenFigure } = useUsageWords()
const inspector = injectInspectorUsage()
const read = inspector?.read
const runs = inspector?.runs

const usage = computed(() => {
  const answer = read?.usage.value ?? null
  return answer && saysAnything({ ...answer, seconds: answer.agent_seconds }) ? answer : null
})
const failed = computed(() => Boolean(read?.failed.value))
/** An epic's rows read their own runs; when those fail, the rows say so and Retry reads both. */
const runsFailed = computed(() => Boolean(runs?.failed.value))
const retry = () => {
  read?.read()
  runs?.read()
}

const noData = computed(() => t('workItem.usage.noData'))
const explained = computed(() => (usage.value ? notes(usage.value) : []))

const figures = computed(() => {
  const shown = usage.value
  if (!shown) return []
  const estimated = isEstimated(shown)
  const parallel = span(shown.elapsed_seconds) !== span(shown.agent_seconds)
  const incomplete = shown.unpriced_models.length > 0
  return [
    {
      key: 'work',
      label: t('workItem.usage.work'),
      value: time(shown.elapsed_seconds, estimated) || noData.value,
    },
    ...(parallel
      ? [
          {
            key: 'agents',
            label: t('workItem.usage.allAgents'),
            value: time(shown.agent_seconds, estimated),
          },
        ]
      : []),
    {
      key: 'cost',
      label: t('workItem.usage.cost'),
      value: cost(shown.estimated_api_cost_usd, incomplete) || noData.value,
    },
    {
      key: 'tokens',
      label: t('workItem.usage.tokensLabel'),
      value: tokenFigure(shown.tokens) || noData.value,
    },
  ]
})

const KINDS: readonly (keyof UsageTokens)[] = [
  'input',
  'cached_read',
  'cache_write_5m',
  'cache_write_1h',
  'output',
  'reasoning',
]

/** Each kind, then what was processed anew: the sum the card's line says. */
const kinds = computed(() => {
  const tokens = usage.value?.tokens
  if (!tokens) return []
  const anew = tokensAnew(tokens)
  return [
    ...KINDS.map((kind) => ({
      key: kind,
      label: t(`workItem.usage.kind.${kind}`),
      value: tokens[kind] === null ? noData.value : count(tokens[kind]),
      known: tokens[kind] !== null,
      part: kind === 'reasoning',
      total: false,
      title: undefined as string | undefined,
    })),
    {
      key: 'anew',
      label: t('workItem.usage.processed'),
      value: anew === null ? noData.value : count(anew),
      known: anew !== null,
      part: false,
      total: true,
      title: t('workItem.usage.processedNote'),
    },
  ]
})

/** Who did the work: the role, then the class it was launched with and its effort. */
function roleName(line: UsageRole) {
  if (line.role === 'advisor') return t('workItem.usage.role.advisor')
  let launch = t('workItem.usage.classNone')
  if (line.launch_class.unknown) launch = t('workItem.usage.classUnknown')
  else if (line.launch_class.id !== null) launch = line.launch_class.id
  const effort = line.effort.unknown
    ? t('workItem.usage.effortUnknown')
    : t('workItem.usage.effortName', { name: line.effort.id ?? '' })
  return [t(`workItem.usage.role.${line.role}`), launch, effort].join(' · ')
}

/**
 * The breakdowns in one shape, a name and its figures in the columns they share: by model, and by
 * who did the work, each in the order the read ranks it.
 */
const breakdowns = computed(() =>
  [
    {
      key: 'models',
      label: t('workItem.usage.models'),
      ids: true,
      rows: (usage.value?.models ?? []).map((line, index) => ({
        key: line.model ?? String(index),
        name: line.model ?? t('workItem.usage.unknownModel'),
        facts: rowFigures(line),
      })),
    },
    {
      key: 'roles',
      label: t('workItem.usage.roles'),
      ids: false,
      rows: (usage.value?.roles ?? []).map((line, index) => ({
        key: `${index}:${line.role}`,
        name: roleName(line),
        facts: rowFigures(line),
      })),
    },
  ].filter((breakdown) => breakdown.rows.length),
)
</script>

<template>
  <section
    v-if="usage"
    class="work-usage"
    :aria-label="t('workItem.usage.work')"
  >
    <p class="work-usage-figures">
      <span
        v-for="figure in figures"
        :key="figure.key"
        class="work-usage-figure"
        >{{ figure.label }} <span class="work-usage-value">{{ figure.value }}</span></span
      >
    </p>
    <ul class="work-usage-notes">
      <li
        v-for="note in explained"
        :key="note"
      >
        {{ note }}
      </li>
    </ul>
    <div class="work-usage-part">
      <span class="work-usage-caption">{{ t('workItem.usage.tokensByKind') }}</span>
      <ul
        class="work-usage-grid"
        :aria-label="t('workItem.usage.tokensByKind')"
      >
        <li
          v-for="row in kinds"
          :key="row.key"
          v-tooltip.detail="row.title"
          class="work-usage-row"
          :class="{ 'is-part': row.part, 'is-total': row.total }"
        >
          <span class="work-usage-name">{{ row.label }}</span>
          <span
            class="work-usage-count"
            :class="{ 'is-unknown': !row.known }"
            >{{ row.value }}</span
          >
        </li>
      </ul>
    </div>
    <div
      v-for="breakdown in breakdowns"
      :key="breakdown.key"
      class="work-usage-part"
    >
      <span class="work-usage-caption">{{ breakdown.label }}</span>
      <ul
        class="work-usage-grid has-columns"
        :aria-label="breakdown.label"
        :data-breakdown="breakdown.key"
      >
        <li
          v-for="row in breakdown.rows"
          :key="row.key"
          class="work-usage-row"
        >
          <span
            class="work-usage-name work-usage-line"
            :class="{ 'is-id': breakdown.ids }"
            >{{ row.name }}</span
          >
          <UsageFacts
            class="work-usage-facts"
            :facts="row.facts"
            columns
          />
        </li>
      </ul>
    </div>
    <div
      v-if="usage.account_stretches.length"
      class="work-usage-part"
    >
      <span class="work-usage-caption">{{ t('workItem.usage.accounts') }}</span>
      <UsageAccounts
        :usage="usage"
        :estimated="isEstimated(usage)"
      />
    </div>
    <ScreenLink
      class="work-usage-analytics"
      :href="itemAnalyticsAddress(usage.work_item_id)"
      >{{ t('workItem.usage.inAnalytics') }}</ScreenLink
    >
  </section>
  <p
    v-if="failed || runsFailed"
    class="work-usage-failed"
    role="alert"
  >
    <span>{{ t('workItem.usage.failed') }}</span>
    <VButton
      variant="ghost"
      size="inline"
      @click="retry"
    >
      {{ t('platform.actions.retry') }}
    </VButton>
  </p>
</template>

<style scoped>
.work-usage {
  display: grid;
  gap: var(--space-heading-content);
  min-width: 0;
}

/* Figures with their words, a row that wraps between them and never inside one, as the chain's
   figures do. The figure is what the row is read for, so it takes the ink and the word does not. */
.work-usage-figures {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1) var(--space-4);
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-detail);
  font-variant-numeric: tabular-nums;
}

.work-usage-figure {
  display: inline-flex;
  gap: var(--space-1);
  white-space: nowrap;
}

.work-usage-value {
  color: var(--color-text);
  font-weight: 500;
}

.work-usage-notes {
  display: grid;
  gap: var(--space-1);
  padding: 0;
  margin: 0;
  color: var(--color-text-tertiary);
  font: var(--font-detail);
  overflow-wrap: anywhere;
  list-style: none;
}

.work-usage-part {
  display: grid;
  gap: var(--space-1);
  min-width: 0;
}

.work-usage-caption {
  color: var(--color-text-muted);
  font: var(--font-group-heading);
}

/* A name and its figure on one line, the figures at the end, where they compare down the list. */
.work-usage-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: var(--space-half) var(--space-3);
  padding: 0;
  margin: 0;
  color: var(--color-text);
  font: var(--font-detail);
  font-variant-numeric: tabular-nums;
  list-style: none;

  &.has-columns {
    grid-template-columns: minmax(0, 1fr) repeat(3, auto);
  }
}

.work-usage-row {
  display: grid;
  grid-template-columns: subgrid;
  grid-column: 1 / -1;
  align-items: baseline;
  min-width: 0;

  &.is-total {
    font-weight: 500;
  }
}

.work-usage-name {
  color: var(--color-text-muted);
  overflow-wrap: anywhere;

  /* What is already inside the row above it, set in under that row. */
  .is-part & {
    padding-inline-start: var(--space-3);
  }
}

.work-usage-count {
  text-align: end;
  white-space: nowrap;

  &.is-unknown {
    color: var(--color-text-tertiary);
  }
}

/* A model is named by its id, in the face ids take; who did the work, in words. */
.work-usage-line {
  grid-column: 1 / -1;

  &.is-id {
    font-family: var(--font-family-mono);
  }
}

.work-usage-facts {
  grid-column: 1 / -1;
  color: var(--color-text-muted);
}

@container drawer (width >= 560px) {
  .work-usage-line {
    grid-column: 1;
  }
}

/* The way to the same work on the Analytics page, as long as its words and no wider. */
.work-usage-analytics {
  justify-self: start;
}

.work-usage-failed {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  align-items: center;
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-detail);
}
</style>
