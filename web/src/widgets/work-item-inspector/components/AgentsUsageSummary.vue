<script setup lang="ts">
/**
 * How much work the item took, whole, at the head of its agents: the time on the clock and what
 * the agents spent together, the cost and the tokens processed anew, and right under them the
 * way to the same work on the Analytics page, which breaks it down by model, effort and kind of
 * token. What a figure counts is its why: pointing at it, focusing it or pressing it says so,
 * since a finger has no hover hint; beside them how many sessions worked on it. One line under
 * them says what a missing price does to the cost, and only when one is missing. Then who did
 * the work — the session's own agent, a subagent by the class it was launched with, an
 * adviser — under which organization, and what it took of each account's weekly quota
 * (`UsageQuota`).
 *
 * A cost nobody reported says so and is never a zero. A read that failed says that it failed,
 * because not knowing is not the same as there being nothing, and offers to read again.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import UsageAccounts from '@/widgets/work-item-inspector/components/UsageAccounts.vue'
import UsageFacts from '@/widgets/work-item-inspector/components/UsageFacts.vue'
import UsageQuota from '@/widgets/work-item-inspector/components/UsageQuota.vue'
import { itemAnalyticsLink } from '@/widgets/work-item-inspector/utils/analyticsLink.ts'
import { injectInspectorUsage } from '@/widgets/work-item-inspector/utils/useInspectorRecord.ts'
import {
  isEstimated,
  saysAnything,
  useUsageWords,
} from '@/widgets/work-item-inspector/utils/useUsageWords.ts'
import { whoWorked } from '@/widgets/work-item-inspector/utils/whoWorked.ts'
import type { WhoWorked } from '@/widgets/work-item-inspector/utils/whoWorked.ts'

import ScreenLink from '@/shared/ui/ScreenLink.vue'
import VButton from '@/shared/ui/VButton.vue'
import WhyWords from '@/shared/ui/WhyWords.vue'

const { t } = useI18n()
const {
  agentTime,
  cost,
  explanations,
  figures: rowFigures,
  sideBySide,
  time,
  tokenFigure,
} = useUsageWords()
const inspector = injectInspectorUsage()
const read = inspector?.read
const runs = inspector?.runs

const usage = computed(() => {
  const answer = read?.usage.value ?? null
  return answer && saysAnything({ ...answer, seconds: answer.agent_seconds }) ? answer : null
})
const failed = computed(() => Boolean(read?.failed.value))
/** A goal's rows read their own runs; when those fail, the rows say so and Retry reads both. */
const runsFailed = computed(() => Boolean(runs?.failed.value))
const retry = () => {
  read?.read()
  runs?.read()
}

/** The way to the same work on the Analytics page, and words that say how much of it opens. */
const analytics = computed(() => {
  if (!usage.value) return null
  const link = itemAnalyticsLink(usage.value)
  return {
    href: link.href,
    words: link.ownOnly ? t('workItem.usage.inAnalyticsOwn') : t('workItem.usage.inAnalytics'),
  }
})

const noData = computed(() => t('workItem.usage.noData'))
const explained = computed(() => (usage.value ? explanations(usage.value) : null))

/** Each figure with its word and what it counts, its why; a figure with no data has none. */
const figures = computed(() => {
  const shown = usage.value
  const why = explained.value
  if (!shown || !why) return []
  const estimated = isEstimated(shown)
  const incomplete = shown.unpriced_models.length > 0
  return [
    {
      key: 'work',
      label: t('workItem.usage.work'),
      value: time(shown.elapsed_seconds, estimated),
      why: [t('workItem.usage.lineMeaning'), ...why.work],
    },
    ...(sideBySide(shown)
      ? [
          {
            key: 'agents',
            label: t('workItem.usage.allAgents'),
            value: agentTime(shown),
            why: why.agents,
          },
        ]
      : []),
    {
      key: 'cost',
      label: t('workItem.usage.cost'),
      value: cost(shown.estimated_api_cost_usd, incomplete),
      why: why.cost,
    },
    {
      key: 'tokens',
      label: t('workItem.usage.tokensLabel'),
      value: tokenFigure(shown.tokens),
      why: [t('workItem.usage.processedNote')],
    },
    {
      key: 'sessions',
      label: t('workItem.usage.sessions'),
      value: String(shown.sessions),
      why: [t('workItem.usage.sessionsNote')],
    },
  ].map((figure) => {
    const value = figure.value || noData.value
    return {
      key: figure.key,
      label: figure.label,
      value,
      words: `${figure.label} ${value}`,
      why: figure.value ? figure.why.join(' ') || undefined : undefined,
    }
  })
})

/** Who did the work: the role, then the class its run was launched with, or an adviser's run's. */
function roleName(line: WhoWorked) {
  let launch = t('workItem.usage.classNone')
  if (line.launch_class.unknown) launch = t('workItem.usage.classUnknown')
  else if (line.launch_class.id !== null) launch = line.launch_class.id
  return [t(`workItem.usage.role.${line.role}`), launch].join(' · ')
}

const who = computed(() =>
  whoWorked(usage.value?.roles ?? []).map((line) => ({
    key: `${line.role}:${line.launch_class.unknown ? '?' : (line.launch_class.id ?? '')}`,
    name: roleName(line),
    facts: rowFigures(line),
  })),
)
</script>

<template>
  <section
    v-if="usage"
    class="work-usage"
    :aria-label="t('workItem.usage.work')"
  >
    <p class="work-usage-figures">
      <WhyWords
        v-for="figure in figures"
        :key="figure.key"
        class="work-usage-figure"
        :text="figure.words"
        :why="figure.why"
        >{{ figure.label }} <span class="work-usage-value">{{ figure.value }}</span></WhyWords
      >
    </p>
    <ScreenLink
      v-if="analytics"
      class="work-usage-analytics"
      :href="analytics.href"
      >{{ analytics.words }}</ScreenLink
    >
    <p
      v-if="explained?.unpriced"
      class="work-usage-note"
    >
      {{ explained.unpriced }}
    </p>
    <div
      v-if="who.length"
      class="work-usage-part"
    >
      <span class="work-usage-caption">{{ t('workItem.usage.roles') }}</span>
      <ul
        class="work-usage-grid"
        data-breakdown="roles"
        :aria-label="t('workItem.usage.roles')"
      >
        <li
          v-for="row in who"
          :key="row.key"
          class="work-usage-row"
        >
          <span class="work-usage-name">{{ row.name }}</span>
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
    <UsageQuota :quota="usage.quota" />
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
  white-space: nowrap;
}

.work-usage-value {
  color: var(--color-text);
  font-weight: 500;
}

/* The way to the same work on the Analytics page, as long as its words and no wider. */
.work-usage-analytics {
  justify-self: start;
}

.work-usage-note {
  margin: 0;
  color: var(--color-text-tertiary);
  font: var(--font-detail);
  overflow-wrap: anywhere;
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

/* A name and its three figures: where the drawer has room the figures stand in columns at the
   end, where they compare down the list, and otherwise on a line of their own under the name. */
.work-usage-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) repeat(3, auto);
  gap: var(--space-half) var(--space-3);
  padding: 0;
  margin: 0;
  color: var(--color-text);
  font: var(--font-detail);
  font-variant-numeric: tabular-nums;
  list-style: none;
}

.work-usage-row {
  display: grid;
  grid-template-columns: subgrid;
  grid-column: 1 / -1;
  align-items: baseline;
  min-width: 0;
}

.work-usage-name {
  grid-column: 1 / -1;
  color: var(--color-text-muted);
  overflow-wrap: anywhere;
}

.work-usage-facts {
  grid-column: 1 / -1;
  color: var(--color-text-muted);
}

@container drawer (width >= 560px) {
  .work-usage-name {
    grid-column: 1;
  }
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
