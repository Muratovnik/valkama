<script setup lang="ts">
/**
 * What this item grew into: its children and everything discovered from them,
 * how much of it is closed, where the rest stands, and whether the scope is
 * still growing.
 *
 * The section exists only where there is a chain. A leaf with nothing
 * discovered from it says nothing here, and a leaf whose chain is still loading
 * says nothing either — only an item known to have children holds the place
 * while it loads, so opening an ordinary task does not flash an empty section.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import ChainMembers from '@/widgets/work-item-inspector/components/ChainMembers.vue'
import ChainScopeChart from '@/widgets/work-item-inspector/components/ChainScopeChart.vue'
import {
  groupMembers,
  sharedStateName,
  splitOrigins,
} from '@/widgets/work-item-inspector/utils/chainSummary.ts'

import type { ChainOrigin, ChainScope, WorkItemChain } from '@/shared/api/planningChainApi.ts'
import { OPEN_CHAIN_GROUPS } from '@/shared/api/planningChainGroups.ts'
import SectionHeader from '@/shared/ui/SectionHeader.vue'
import SegmentedControl from '@/shared/ui/SegmentedControl.vue'
import VButton from '@/shared/ui/VButton.vue'

const props = defineProps<{
  chain: WorkItemChain | null
  /** The item has children, so a chain is certain before it has loaded. */
  container: boolean
  failed: boolean
  loading: boolean
  scope: ChainScope
}>()

const emit = defineEmits<{
  graph: [chain: WorkItemChain]
  open: [reference: string]
  retry: []
  scope: [scope: ChainScope]
}>()

const { t, locale } = useI18n()

const visible = computed(() =>
  props.chain ? props.chain.total > 0 : props.container && (props.loading || props.failed),
)

/** Busy only while a read runs; absent otherwise rather than a claim of `false`. */
const busy = computed(() => (props.loading ? true : undefined))

/** Whether the failure lost the chain or only its latest refresh. */
const failureText = computed(() =>
  t(props.chain ? 'workItem.chain.refreshFailed' : 'workItem.chain.loadFailed'),
)

/** A parent's title as its tooltip, or no tooltip when the origin has no parent. */
function originTitle(origin: ChainOrigin): string | undefined {
  return origin.parent_title ?? undefined
}

const scopes = computed(() => [
  { value: 'epic' as const, label: t('workItem.chain.scopeEpic') },
  { value: 'chain' as const, label: t('workItem.chain.scopeChain') },
])

const groups = computed(() => (props.chain ? groupMembers(props.chain.members) : null))

/**
 * The open work broken down by category, in the space's own state names where
 * a group has one, and how much of it the space would let someone take now.
 */
const breakdown = computed(() => {
  const chain = props.chain
  const current = groups.value
  if (!chain || !current) return ''
  if (chain.open === 0) return t('workItem.chain.noneOpen')
  const parts = OPEN_CHAIN_GROUPS.filter((group) => current[group].length > 0)
    .map((group) =>
      t('workItem.chain.part', {
        group: (
          sharedStateName(current[group]) ?? t(`workItem.chain.group.${group}`)
        ).toLocaleLowerCase(locale.value),
        count: current[group].length,
      }),
    )
    .join(' · ')
  const line = t('workItem.chain.openParts', { open: chain.open, parts })
  return chain.ready ? `${line} · ${t('workItem.chain.workable', { count: chain.ready })}` : line
})

const headline = computed(() =>
  props.chain
    ? t('workItem.chain.headline', { total: props.chain.total, closed: props.chain.closed })
    : '',
)

const trend = computed(() => {
  const recent = props.chain?.recent
  if (!recent) return ''
  return t(props.chain?.scope === 'epic' ? 'workItem.chain.trendEpic' : 'workItem.chain.trend', {
    days: recent.days,
    created: recent.created,
    closed: recent.closed,
    verdict: t(`workItem.chain.verdict.${recent.trend}`),
  })
})

const origins = computed(() => (props.chain ? splitOrigins(props.chain) : null))
/**
 * The origin lines as text a reader hears whole. The gaps on screen are layout,
 * so each piece carries its own space and dash rather than relying on markup
 * between elements, which reads as one run-on word to a screen reader.
 */
const ownLine = computed(() => {
  const chain = props.chain
  const own = origins.value?.own
  if (!chain || !own) return ''
  const label = t(
    chain.root.kind === 'epic' ? 'workItem.chain.ownEpic' : 'workItem.chain.ownItem',
    {
      reference: chain.root.reference,
    },
  )
  return `${label} ${t('workItem.chain.originCount', own)}`
})
const laterLabel = computed(() => `${t('workItem.chain.discoveredLater')} `)
function entryCount(origin: ChainOrigin): string {
  return ` — ${t('workItem.chain.originCount', origin)}`
}
</script>

<template>
  <section
    v-if="visible"
    class="chain"
    :aria-busy="busy"
    :aria-label="t('workItem.chain.title')"
  >
    <SectionHeader
      :title="t('workItem.chain.title')"
      :count="chain?.total ?? ''"
    >
      <template
        v-if="chain"
        #actions
      >
        <VButton
          variant="ghost"
          size="inline"
          @click="emit('graph', chain)"
        >
          {{ t('workItem.chain.showOnGraph') }}
        </VButton>
      </template>
    </SectionHeader>

    <SegmentedControl
      v-if="chain?.root.has_children"
      class="chain-scope"
      size="compact"
      :label="t('workItem.chain.scopeLabel')"
      :model-value="scope"
      :options="scopes"
      @update:model-value="(next) => emit('scope', next)"
    />

    <p
      v-if="!chain && loading"
      class="chain-quiet"
      role="status"
    >
      {{ t('workItem.chain.loading') }}
    </p>
    <div
      v-if="failed"
      class="chain-failure"
      role="alert"
    >
      <span>{{ failureText }}</span>
      <VButton
        variant="ghost"
        size="inline"
        :disabled="loading"
        @click="emit('retry')"
      >
        {{ t('platform.actions.retry') }}
      </VButton>
    </div>

    <template v-if="chain && groups && origins">
      <div class="chain-summary">
        <p class="chain-headline">
          {{ headline }}
        </p>
        <p class="chain-breakdown">{{ breakdown }}</p>
        <p class="chain-trend">{{ trend }}</p>
      </div>

      <ChainScopeChart
        v-if="chain.series.length > 1"
        :series="chain.series"
      />

      <ul class="chain-origins">
        <li
          v-if="origins.own"
          class="chain-origin"
        >
          {{ ownLine }}
        </li>
        <li
          v-if="origins.later.length"
          class="chain-origin chain-origin-later"
        >
          <span class="chain-origin-label">{{ laterLabel }}</span>
          <span
            v-for="origin in origins.later"
            :key="origin.parent_reference ?? ''"
            class="chain-origin-entry"
          >
            <button
              v-if="origin.parent_reference"
              class="chain-origin-link"
              type="button"
              :title="originTitle(origin)"
              @click="emit('open', origin.parent_reference)"
            >
              {{ origin.parent_reference }}
            </button>
            <span v-else>{{ t('workItem.chain.noEpic') }}</span>
            <span class="chain-origin-count">{{ entryCount(origin) }}</span>
          </span>
        </li>
      </ul>

      <ChainMembers
        :groups="groups"
        @open="(reference) => emit('open', reference)"
      />
    </template>
  </section>
</template>

<style scoped>
.chain {
  display: grid;
  gap: var(--space-heading-content);
  min-width: 0;
}

.chain-scope {
  justify-self: start;
}

.chain-summary {
  display: grid;
  gap: var(--space-1);
}

.chain-headline {
  margin: 0;
  color: var(--color-text);
  font: var(--font-strong);
  font-variant-numeric: tabular-nums;
}

.chain-breakdown,
.chain-trend {
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-detail);
  font-variant-numeric: tabular-nums;
}

.chain-quiet {
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-detail);
}

.chain-failure {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  align-items: center;
  color: var(--color-text-muted);
  font: var(--font-detail);
}

.chain-origins {
  display: grid;
  gap: var(--space-1);
  padding: 0;
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-detail);
  list-style: none;
}

.chain-origin {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1) var(--space-2);
  align-items: baseline;
}

.chain-origin-label {
  color: var(--color-text-tertiary);
}

.chain-origin-entry {
  display: inline-flex;
  gap: var(--space-1);
  align-items: baseline;

  &:not(:last-child)::after {
    content: '·';
    padding-inline-start: var(--space-1);
    color: var(--color-text-tertiary);
  }
}

.chain-origin-count {
  font-variant-numeric: tabular-nums;
}

/* A reference riding a line of text: an inline target, not a form row. */
.chain-origin-link {
  min-block-size: var(--size-control-inline);
  padding: 0;
  border: 0;
  color: var(--color-action-primary);
  font: inherit;
  font-variant-numeric: tabular-nums;
  background: none;
  cursor: pointer;

  &:hover,
  &:focus-visible {
    text-decoration: underline;
  }
}
</style>
