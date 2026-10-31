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
 *
 * An item of an attached store is the exception. The chain read answers for
 * the primary store alone, so the card asks it nothing for one, and the section
 * says where a chain can be read instead of leaving the reader to wonder why
 * there is none.
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import ChainBranchMap from '@/widgets/work-item-inspector/components/ChainBranchMap.vue'
import ChainMembers from '@/widgets/work-item-inspector/components/ChainMembers.vue'
import ChainScopeChart from '@/widgets/work-item-inspector/components/ChainScopeChart.vue'
import { groupMembers, sharedStateName } from '@/widgets/work-item-inspector/utils/chainSummary.ts'
import { useChainForecast } from '@/widgets/work-item-inspector/utils/useChainForecast.ts'

import type { ChainScope, WorkItemChain } from '@/shared/api/planningChainApi.ts'
import { OPEN_CHAIN_GROUPS } from '@/shared/api/planningChainGroups.ts'
import SectionHeader from '@/shared/ui/SectionHeader.vue'
import SegmentedControl from '@/shared/ui/SegmentedControl.vue'
import VButton from '@/shared/ui/VButton.vue'
import VIcon from '@/shared/ui/VIcon.vue'

const props = defineProps<{
  chain: WorkItemChain | null
  /** The item has children, so a chain is certain before it has loaded. */
  container: boolean
  failed: boolean
  loading: boolean
  /** The chain read reaches this item: it is in the primary store, not an attached one. */
  readable: boolean
  scope: ChainScope
}>()

const emit = defineEmits<{
  graph: [chain: WorkItemChain]
  open: [reference: string]
  retry: []
  scope: [scope: ChainScope]
}>()

const { t, locale } = useI18n()

const visible = computed(() => {
  if (!props.readable) return true
  return props.chain ? props.chain.total > 0 : props.container && (props.loading || props.failed)
})

/** Busy only while a read runs; absent otherwise rather than a claim of `false`. */
const busy = computed(() => (props.loading ? true : undefined))

/** Whether the failure lost the chain or only its latest refresh. */
const failureText = computed(() =>
  t(props.chain ? 'workItem.chain.refreshFailed' : 'workItem.chain.loadFailed'),
)

const scopes = computed(() => [
  { value: 'epic' as const, label: t('workItem.chain.scopeEpic') },
  { value: 'chain' as const, label: t('workItem.chain.scopeChain') },
])

const groups = computed(() => (props.chain ? groupMembers(props.chain.members) : null))

/**
 * The lane the member list is narrowed to, chosen on the map. It is a reading
 * of the current answer, so a lane the answer no longer has — another scope,
 * another refresh — reads as no filter rather than as an empty list.
 */
const chosenLane = ref<string | null>(null)
const laneOf = (member: { parent_reference: string | null }) => member.parent_reference ?? ''
const lane = computed(() => {
  const key = chosenLane.value
  return key !== null && props.chain?.members.some((member) => laneOf(member) === key) ? key : null
})
const listed = computed(() => {
  const chain = props.chain
  return !chain || lane.value === null
    ? groups.value
    : groupMembers(chain.members.filter((member) => laneOf(member) === lane.value))
})
const laneName = computed(() => lane.value || t('workItem.chain.noEpic'))
/**
 * The epic a narrowed lane came from, when it is another card to open: not the
 * root, which is this card, and not the lane of work filed under no epic.
 */
const laneEpic = computed(() =>
  lane.value && lane.value !== props.chain?.root.reference ? lane.value : null,
)

/** A lane label narrows the list to its lane; the same label again widens it back. */
function chooseLane(key: string) {
  chosenLane.value = lane.value === key ? null : key
}

/**
 * The open work broken down by category, in the space's own state names where
 * a group has one, and how much of it the space would let someone take now.
 * That figure is the read model's rule — unheld, unblocked, in any state work
 * can start from, the backlog included — so it may exceed the to-do group, and
 * the wording says why rather than reading as one more category.
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
  return chain.ready ? `${line}; ${t('workItem.chain.workable', { count: chain.ready })}` : line
})

const headline = computed(() =>
  props.chain
    ? t('workItem.chain.headline', { total: props.chain.total, closed: props.chain.closed })
    : '',
)

const forecast = useChainForecast(() => props.chain)
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

    <p
      v-if="!readable"
      class="chain-quiet"
    >
      {{ t('workItem.chain.primaryOnly') }}
    </p>

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

    <template v-if="chain && groups && listed">
      <div class="chain-summary">
        <p class="chain-headline">
          {{ headline }}
        </p>
        <p class="chain-forecast">{{ forecast }}</p>
        <p class="chain-breakdown">{{ breakdown }}</p>
      </div>

      <ChainBranchMap
        :chain="chain"
        :filter="lane"
        @lane="chooseLane"
        @open="(reference) => emit('open', reference)"
      />

      <ChainScopeChart
        v-if="chain.series.length > 1"
        :series="chain.series"
      />

      <div
        v-if="lane !== null"
        class="chain-lane-filter"
      >
        <button
          class="chain-lane-chip"
          type="button"
          :aria-label="t('workItem.chain.map.clearFilter', { name: laneName })"
          @click="chosenLane = null"
        >
          {{ t('workItem.chain.map.filter', { name: laneName }) }}
          <VIcon
            name="close"
            :size="14"
          />
        </button>
        <VButton
          v-if="laneEpic"
          variant="ghost"
          size="inline"
          @click="emit('open', laneEpic)"
        >
          {{ t('workItem.chain.map.openEpic', { reference: laneEpic }) }}
        </VButton>
      </div>

      <ChainMembers
        :groups="listed"
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
.chain-forecast {
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-detail);
  font-variant-numeric: tabular-nums;
}

/* Whether and when the open part closes is what the totals above it are read
   for, so it ranks next to them: their tone, the detail's size and weight. */
.chain-forecast {
  color: var(--color-text);
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

/* The lane the list below is narrowed to: a filled chip that is the way back
   to every lane, the whole of it one target, and the way into its epic. */
.chain-lane-filter {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  align-items: center;
}

.chain-lane-chip {
  display: inline-flex;
  gap: var(--space-2);
  justify-self: start;
  align-items: center;
  min-height: var(--size-control-inline);
  padding: 0 var(--space-2) 0 var(--space-3);
  border: 0;
  color: var(--color-text);
  font: var(--font-chip);
  font-variant-numeric: tabular-nums;
  background: var(--color-control-surface);
  border-radius: var(--radius-control);
  cursor: pointer;

  &:hover {
    background: var(--color-surface-hover);
  }

  &:focus-visible {
    outline: 2px solid var(--color-focus-ring);
    outline-offset: 2px;
  }
}
</style>
