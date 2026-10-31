<script setup lang="ts">
/**
 * The chain's members by where they stand, each row one way into its own card.
 *
 * Open groups are listed and the finished ones folded under one disclosure: a
 * chain that ran for weeks holds hundreds of closed items, and listing them
 * first would bury the dozen a reader can act on. A long group stops after a
 * screenful and says how many more it holds, rather than scrolling the drawer
 * past everything below it.
 */
import { computed, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { rowStateName, sharedStateName } from '@/widgets/work-item-inspector/utils/chainSummary.ts'
import type { ChainGroups } from '@/widgets/work-item-inspector/utils/chainSummary.ts'

import type { ChainMember } from '@/shared/api/planningChainApi.ts'
import { CHAIN_GROUPS } from '@/shared/api/planningChainGroups.ts'
import type { ChainGroup } from '@/shared/api/planningChainGroups.ts'
import { actorName } from '@/shared/lib/actor.ts'
import SemanticState from '@/shared/ui/SemanticState.vue'
import VButton from '@/shared/ui/VButton.vue'
import VIcon from '@/shared/ui/VIcon.vue'

const props = defineProps<{ groups: ChainGroups }>()
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

function hidden(group: ChainGroup): number {
  return expanded[group] ? 0 : Math.max(0, props.groups[group].length - LIMIT)
}

/** The heading a group stands under: its name and how many it holds. */
function groupHeading(group: ChainGroup): string {
  return t('workItem.chain.groupCount', {
    group: groupLabel(group),
    count: props.groups[group].length,
  })
}

/** The space's name for the group's one state, or the category's name. */
function groupLabel(group: ChainGroup): string {
  return sharedStateName(props.groups[group]) ?? t(`workItem.chain.group.${group}`)
}

function isDone(group: ChainGroup): boolean {
  return group === 'done'
}

/**
 * Who holds an open item; otherwise its state, unless the heading above already
 * names the one state the whole group is in. A closed one says how it ended on
 * the same terms.
 */
function detail(group: ChainGroup, member: ChainMember): string | null {
  if (!isDone(group) && member.claim_ref) return actorName(member.claim_ref)
  return rowStateName(props.groups[group], member)
}
</script>

<template>
  <div class="chain-members">
    <section
      v-for="group in visibleGroups"
      :key="group"
      class="chain-group"
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
        <ul class="chain-rows">
          <li
            v-for="member in shown(group)"
            :key="member.work_item_id"
          >
            <button
              class="chain-row"
              type="button"
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
                >{{ t('workItem.chain.workableMark') }}</span
              >
              <span
                v-if="detail(group, member)"
                class="chain-row-detail"
                >{{ detail(group, member) }}</span
              >
            </button>
          </li>
        </ul>
        <VButton
          v-if="hidden(group)"
          class="chain-more"
          variant="ghost"
          size="inline"
          @click="expanded[group] = true"
        >
          {{ t('workItem.chain.showAll', { count: groups[group].length }) }}
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

.chain-row-ready {
  grid-column: 3;
  color: var(--color-action-primary);
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
}
</style>
