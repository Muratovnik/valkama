<script setup lang="ts">
/**
 * The chain's members by where they stand, each row one way into its own card.
 *
 * Open groups are listed and the finished ones folded under one disclosure: a
 * chain that ran for weeks holds hundreds of closed items, and listing them
 * first would bury the dozen a reader can act on. A long group stops after a
 * screenful and says how many more it holds, rather than scrolling the drawer
 * past everything below it.
 *
 * That stop is a disclosure that goes both ways, as a board lane's is: «Show
 * all · N» opens the rest and puts focus on the first row it revealed, so the
 * list grows below where the reader was; «Show fewer», at the end of the list,
 * closes it again and returns focus to itself. The toggle stays mounted through
 * both, which is what kept focus from falling to the page when it vanished.
 */
import { computed, nextTick, reactive, ref, useId } from 'vue'
import { useI18n } from 'vue-i18n'

import { rowStateName } from '@/widgets/work-item-inspector/utils/chainSummary.ts'
import type { ChainGroups, GroupLabels } from '@/widgets/work-item-inspector/utils/chainSummary.ts'
import type { MembersView } from '@/widgets/work-item-inspector/utils/inspectorReturn.ts'

import type { ChainMember } from '@/shared/api/planningChainApi.ts'
import { CHAIN_GROUPS } from '@/shared/api/planningChainGroups.ts'
import type { ChainGroup } from '@/shared/api/planningChainGroups.ts'
import { holderName } from '@/shared/lib/actor.ts'
import SemanticState from '@/shared/ui/SemanticState.vue'
import VButton from '@/shared/ui/VButton.vue'
import VIcon from '@/shared/ui/VIcon.vue'

const props = defineProps<{
  groups: ChainGroups
  /** The section's word for each group, read off the whole chain. */
  labels: GroupLabels
}>()
const emit = defineEmits<{ open: [reference: string] }>()
const { t } = useI18n()

const LIMIT = 8

const expanded = reactive<Partial<Record<ChainGroup, boolean>>>({})
const doneOpen = ref(false)

const doneIcon = computed(() => (doneOpen.value ? 'chevron-down' : 'chevron-right'))

/** Open groups in the card's order, then the folded finished work. */
const visibleGroups = computed(() => CHAIN_GROUPS.filter((group) => props.groups[group].length > 0))

function shown(group: ChainGroup) {
  const members = props.groups[group]
  return expanded[group] ? members : members.slice(0, LIMIT)
}

/** A group longer than one screenful has a toggle, open or closed. */
function long(group: ChainGroup): boolean {
  return props.groups[group].length > LIMIT
}

/** What the toggle offers: the rest of the group, or the short list back. */
function moreLabel(group: ChainGroup): string {
  return expanded[group]
    ? t('workItem.chain.showFewer')
    : t('workItem.chain.showAll', { count: props.groups[group].length })
}

const root = ref<HTMLElement | null>(null)
const listId = useId()
const listOf = (group: ChainGroup) => `${listId}-${group}`

function within(group: ChainGroup) {
  return root.value?.querySelector<HTMLElement>(`[data-group="${group}"]`) ?? null
}

/**
 * Open a long group past its first rows, or close it back to them. Opening
 * puts focus on the first row it revealed; closing puts it back on the toggle.
 */
async function toggle(group: ChainGroup) {
  const opening = !expanded[group]
  expanded[group] = opening
  await nextTick()
  const target = opening
    ? within(group)?.querySelectorAll<HTMLElement>('.chain-row')[LIMIT]
    : within(group)?.querySelector<HTMLElement>('.chain-more')
  target?.focus({ preventScroll: true })
  target?.scrollIntoView({ block: 'nearest' })
}

/** Which groups are open, so a card left for another can be read again the same way. */
function view(): MembersView {
  return {
    doneOpen: doneOpen.value,
    expanded: CHAIN_GROUPS.filter((group) => expanded[group]),
  }
}

function restoreView(next: MembersView) {
  doneOpen.value = next.doneOpen
  for (const group of next.expanded) expanded[group] = true
}

/**
 * The row of one member, shown even where it sat past a group's first rows or
 * under the folded Done, or null when the list does not hold it.
 */
async function reveal(reference: string): Promise<HTMLElement | null> {
  const group = CHAIN_GROUPS.find((key) =>
    props.groups[key].some((member) => member.reference === reference),
  )
  if (group === undefined) return null
  if (isDone(group)) doneOpen.value = true
  if (props.groups[group].findIndex((member) => member.reference === reference) >= LIMIT)
    expanded[group] = true
  await nextTick()
  return within(group)?.querySelector<HTMLElement>(`[data-reference="${reference}"]`) ?? null
}

/** The heading a group stands under: its name and how many it holds. */
function groupHeading(group: ChainGroup): string {
  return t('workItem.chain.groupCount', {
    group: groupLabel(group),
    count: props.groups[group].length,
  })
}

/** The space's name for the group's one state, or the group's own word. */
function groupLabel(group: ChainGroup): string {
  return props.labels[group].text
}

function isDone(group: ChainGroup): boolean {
  return group === 'done'
}

/** Who holds an open item, if anyone does. */
function holder(group: ChainGroup, member: ChainMember): string | null {
  return !isDone(group) && member.claim_ref ? holderName(member.claim_ref) : null
}

/**
 * An unheld item's state, unless the heading above already names the one state
 * the whole group is in. A closed one says how it ended on the same terms.
 */
function stateWord(group: ChainGroup, member: ChainMember): string | null {
  return holder(group, member) ? null : rowStateName(props.labels[group], member)
}
defineExpose({ restoreView, reveal, view })
</script>

<template>
  <div
    ref="root"
    class="chain-members"
  >
    <section
      v-for="group in visibleGroups"
      :key="group"
      class="chain-group"
      :data-group="group"
      :aria-label="groupLabel(group)"
    >
      <button
        v-if="group === 'done'"
        class="chain-done-toggle"
        type="button"
        :aria-expanded="doneOpen"
        @click="doneOpen = !doneOpen"
      >
        <VIcon
          :name="doneIcon"
          :size="16"
        />
        {{ groupHeading('done') }}
      </button>
      <h4
        v-else
        class="chain-group-title"
      >
        <SemanticState
          variant="dot"
          dimension="work-item-chain-group"
          aria-hidden="true"
          label=""
          :state="group"
        />
        {{ groupHeading(group) }}
      </h4>
      <template v-if="group !== 'done' || doneOpen">
        <ul
          :id="listOf(group)"
          class="chain-rows"
        >
          <li
            v-for="member in shown(group)"
            :key="member.work_item_id"
          >
            <button
              class="chain-row"
              type="button"
              :data-reference="member.reference"
              :class="{ 'is-done': isDone(group) }"
              @click="emit('open', member.reference)"
            >
              <span class="chain-row-reference">{{ member.reference }}</span>
              <span
                class="chain-row-title"
                :title="member.title"
                >{{ member.title }}</span
              >
              <span
                v-if="member.ready"
                class="chain-row-ready"
                >{{ t('workItem.facet.ready') }}</span
              >
              <span
                v-if="holder(group, member)"
                class="chain-row-detail chain-row-holder"
                >{{ holder(group, member) }}</span
              >
              <span
                v-else-if="stateWord(group, member)"
                class="chain-row-detail"
                >{{ stateWord(group, member) }}</span
              >
            </button>
          </li>
        </ul>
        <VButton
          v-if="long(group)"
          class="chain-more"
          variant="ghost"
          size="inline"
          :aria-expanded="Boolean(expanded[group])"
          :aria-controls="listOf(group)"
          @click="toggle(group)"
        >
          {{ moreLabel(group) }}
        </VButton>
      </template>
    </section>
  </div>
</template>

<style scoped>
.chain-members {
  display: grid;
  gap: var(--space-4);
  min-width: 0;
  container: chain-members / inline-size;
}

.chain-group {
  display: grid;
  gap: var(--space-1);
  min-width: 0;
}

.chain-group-title {
  display: flex;
  gap: var(--space-2);
  align-items: center;
  margin: 0;
  color: var(--color-text);
  font: var(--font-group-heading);
}

.chain-rows {
  display: grid;
  padding: 0;
  margin: 0;
  list-style: none;
}

/* One line per member: its reference, as much of its title as fits, and who
   holds it (or its state) at the end. */
.chain-row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto auto;
  gap: var(--space-3);
  align-items: baseline;
  width: 100%;
  min-height: var(--size-control-inline);
  padding: var(--space-1) var(--space-2);
  border: 0;
  color: var(--color-text);
  font: var(--font-line);
  text-align: start;
  background: none;
  border-radius: var(--radius-status);
  cursor: pointer;

  &:hover {
    background: var(--color-surface-hover);
  }

  &:focus-visible {
    outline: 2px solid var(--color-focus-ring);
    outline-offset: -2px;
  }

  &.is-done {
    color: var(--color-text-muted);
  }
}

.chain-row-reference {
  color: var(--color-text-muted);
  font-variant-numeric: tabular-nums;
}

.chain-row-title {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Most open rows are workable, so the word repeats down a whole group: in the
   holder's quiet tone it is there for a reader who looks, and leaves the
   titles to be read first. */
.chain-row-ready {
  grid-column: 3;
  color: var(--color-text-tertiary);
  font: var(--font-detail);
  white-space: nowrap;
}

.chain-row-detail {
  grid-column: 4;
  max-width: 14ch;
  color: var(--color-text-tertiary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* On a narrow list the name gives way before the state word does, and who
   holds a task gives way before its name: at a phone's width the holder took a
   third of the row and left the title a dozen characters. The card of the task
   names its holder. */
@container chain-members (width < 480px) {
  .chain-row-holder {
    display: none;
  }
}

.chain-more {
  justify-self: start;
}

.chain-done-toggle {
  display: inline-flex;
  gap: var(--space-1);
  justify-self: start;
  align-items: center;
  min-height: var(--size-control-inline);
  padding: 0;
  border: 0;
  color: var(--color-text-muted);
  font: var(--font-group-heading);
  background: none;
  cursor: pointer;

  &:hover,
  &:focus-visible {
    color: var(--color-text);
  }

  &:focus-visible {
    border-radius: var(--radius-status);
    outline: 2px solid var(--color-focus-ring);
    outline-offset: 2px;
  }
}
</style>
