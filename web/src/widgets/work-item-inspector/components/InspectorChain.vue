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
import { computed, nextTick, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import ChainBranchMap from '@/widgets/work-item-inspector/components/ChainBranchMap.vue'
import ChainDetails from '@/widgets/work-item-inspector/components/ChainDetails.vue'
import ChainMembers from '@/widgets/work-item-inspector/components/ChainMembers.vue'
import { groupLabels, groupMembers } from '@/widgets/work-item-inspector/utils/chainSummary.ts'
import type { ChainView } from '@/widgets/work-item-inspector/utils/inspectorReturn.ts'
import { useChainForecast } from '@/widgets/work-item-inspector/utils/useChainForecast.ts'

import { waitingOn } from '@/entities/work-item/utils/waiting.ts'

import type { ChainScope, WorkItemChain } from '@/shared/api/planningChainApi.ts'
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
  /** The branch chosen on the map rides along: an epic's reference, `''` for no epic, or null. */
  graph: [chain: WorkItemChain, branch: string | null]
  open: [reference: string]
  retry: []
  scope: [scope: ChainScope]
}>()

const { t } = useI18n()

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

/** The open blocker each member waits on, where the blocker is another member of this chain. */
const waiting = computed(() =>
  props.chain ? waitingOn(props.chain.edges, props.chain.members) : new Map<string, string>(),
)

/** One word per group for the whole section: the map's legend, the line under it and the list. */
const labels = computed(() =>
  groups.value ? groupLabels(groups.value, (group) => t(`workItem.chain.group.${group}`)) : null,
)

/**
 * The lane the member list is narrowed to, chosen on the map. It is a reading
 * of the current answer, so a lane the answer no longer has — another scope,
 * another refresh — reads as no filter rather than as an empty list, and so does
 * the only lane an answer has, which narrows nothing.
 */
const chosenLane = ref<string | null>(null)
const laneOf = (member: { parent_reference: string | null }) => member.parent_reference ?? ''
const lane = computed(() => {
  const key = chosenLane.value
  const lanes = new Set(props.chain?.members.map((member) => laneOf(member)))
  return key !== null && lanes.size > 1 && lanes.has(key) ? key : null
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

/**
 * The chip that heads a narrowed list. Choosing a lane brings it into view when
 * it is not, so the list the choice narrowed is seen without looking for it.
 */
const laneFilter = ref<HTMLElement | null>(null)

/** A lane label narrows the list to its lane; the same label again widens it back. */
async function chooseLane(key: string) {
  chosenLane.value = lane.value === key ? null : key
  if (chosenLane.value === null) return
  await nextTick()
  laneFilter.value?.scrollIntoView({ block: 'nearest' })
}

/**
 * The chain's main figures, each with its word: how much grew from this item, how
 * much of it is open, and how much of that the space would let someone take now.
 * How much is finished and where the open work stands, group by group, are the
 * map's key above it, so no group is named twice on one screen.
 *
 * The workable figure is the read model's rule — unheld, unblocked, in any state
 * work can start from, the backlog included — so it may exceed the to-do group, and
 * its note says why rather than reading as one more category.
 *
 * The total is said as what it is — the work under the root, the root itself
 * not counted — because the board's chain chip counts the root too and reads
 * one more for the same chain; an unlabelled 306 beside a 307 read as a fault.
 * It is the section's only count, so it is never one of two numbers for "the chain".
 */
const stats = computed<{ key: string; label: string; value: number | null; note?: string }[]>(
  () => {
    const chain = props.chain
    if (!chain) return []
    const total = { key: 'total', label: t('workItem.chain.stat.total'), value: chain.total }
    if (chain.open === 0)
      return [total, { key: 'none', label: t('workItem.chain.stat.noneOpen'), value: null }]
    const open = { key: 'open', label: t('workItem.chain.stat.open'), value: chain.open }
    if (!chain.ready) return [total, open]
    // With all the work in one state there is no other group for the figure to exceed.
    const several = Object.values(groups.value ?? {}).filter((group) => group.length > 0).length > 1
    return [
      total,
      open,
      {
        key: 'workable',
        label: t('workItem.chain.stat.workable'),
        value: chain.ready,
        ...(several ? { note: t('workItem.chain.stat.workableNote') } : {}),
      },
    ]
  },
)

const members = ref<InstanceType<typeof ChainMembers> | null>(null)

/** The pace and the chart, one action away. */
const detailsOpen = ref(false)

/** How this section is being read, apart from the scope, which the card holds. */
function view(): Omit<ChainView, 'scope'> {
  return {
    details: detailsOpen.value,
    lane: lane.value,
    ...(members.value?.view() ?? { doneOpen: false, expanded: [] }),
  }
}

/** Read the section the same way again: its details, the lane chosen on the map, the open groups. */
async function restore(next: Omit<ChainView, 'scope'>) {
  detailsOpen.value = next.details
  chosenLane.value = next.lane
  await nextTick()
  members.value?.restoreView(next)
}

/** The row of a member, shown, or null when the section does not list it. */
async function reveal(reference: string) {
  return (await members.value?.reveal(reference)) ?? null
}

const { pace, verdict } = useChainForecast(() => props.chain)

defineExpose({ restore, reveal, view })
</script>

<template>
  <section
    v-if="visible"
    class="chain"
    :aria-busy="busy"
    :aria-label="t('workItem.chain.title')"
  >
    <!-- No count beside the heading: the line under the map is the card's one
         number for the chain and says what it counts, the work under the root.
         A bare 306 here stood beside the board's «Chain MAIN-1 · 307», which
         counts the root as well, and in Epic scope it named a third population. -->
    <SectionHeader :title="t('workItem.chain.title')">
      <template
        v-if="chain"
        #actions
      >
        <SegmentedControl
          v-if="chain.root.has_children"
          class="chain-scope"
          size="compact"
          :label="t('workItem.chain.scopeLabel')"
          :model-value="scope"
          :options="scopes"
          @update:model-value="(next) => emit('scope', next)"
        />
        <VButton
          variant="ghost"
          size="inline"
          :aria-label="t('workItem.chain.showOnGraph')"
          :title="t('workItem.chain.showOnGraph')"
          @click="emit('graph', chain, lane)"
        >
          {{ t('workItem.chain.onGraph') }}
        </VButton>
      </template>
    </SectionHeader>

    <p
      v-if="!readable"
      class="chain-quiet"
    >
      {{ t('workItem.chain.primaryOnly') }}
    </p>

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

    <div
      v-if="chain && groups && listed && labels"
      class="chain-body"
    >
      <ChainBranchMap
        :chain="chain"
        :filter="lane"
        :labels="labels"
        @lane="chooseLane"
        @open="(reference) => emit('open', reference)"
      />

      <div class="chain-summary">
        <p class="chain-summary-line">
          <span
            v-for="stat in stats"
            :key="stat.key"
            class="chain-stat"
            >{{ stat.label }}
            <span
              v-if="stat.value !== null"
              class="chain-stat-value"
              >{{ stat.value }}</span
            >
            <span
              v-if="stat.note"
              class="chain-stat-note"
              >{{ stat.note }}</span
            ></span
          >
        </p>
        <p
          v-if="verdict"
          class="chain-forecast"
        >
          {{ verdict }}
        </p>
        <ChainDetails
          v-if="lane === null"
          v-model:open="detailsOpen"
          :pace="pace"
          :series="chain.series"
        />
      </div>

      <div
        v-if="lane !== null"
        ref="laneFilter"
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
        ref="members"
        :groups="listed"
        :labels="labels"
        :waiting="waiting"
        @open="(reference) => emit('open', reference)"
      />

      <!-- The history is the whole chain's; under a narrowed list it follows the list. -->
      <ChainDetails
        v-if="lane !== null"
        v-model:open="detailsOpen"
        :pace="pace"
        :series="chain.series"
      />
    </div>
  </section>
</template>

<style scoped>
.chain {
  display: grid;
  gap: var(--space-heading-content);
  min-width: 0;
}

/* Three parts, the map, its figures and the list, stand further apart than the rows inside
   any one of them, or they read as one run of equal rows. */
.chain-body {
  display: grid;
  gap: var(--space-5);
  min-width: 0;
}

.chain-summary {
  display: grid;
  gap: var(--space-1);
}

/* Figures with their words, a row that wraps between them and never inside one.
   The figure is what the row is read for, so it takes the ink and the word does not. */
.chain-summary-line {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1) var(--space-4);
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-detail);
  font-variant-numeric: tabular-nums;
}

.chain-stat {
  display: inline-flex;
  gap: var(--space-1);
  white-space: nowrap;
}

.chain-stat-value {
  color: var(--color-text);
  font-weight: 500;
}

.chain-stat-note {
  color: var(--color-text-tertiary);
}

/* Whether and when the open part closes is what the line above it is read
   for, so it ranks next to it: its tone, the detail's size and weight. */
.chain-forecast {
  margin: 0;
  color: var(--color-text);
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

/* The lane the list below is narrowed to: a filled chip that is the way back
   to every lane, the whole of it one target, and the way into its epic. */
.chain-lane-filter {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  align-items: center;

  /* Brought into view, it brings the first rows of its list with it. */
  scroll-margin-block-end: calc(4 * var(--size-control-inline));
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

  /* One step above the rest fill. `--color-surface-hover` is the same tone as
     the control fill, so a hover written with it drew nothing. */
  &:hover {
    background: var(--color-surface-active);
  }

  &:focus-visible {
    outline: 2px solid var(--color-focus-ring);
    outline-offset: 2px;
  }
}
</style>
