<script setup lang="ts">
/**
 * A goal's or a stage's contents: how much of its work stands in each state, then the work
 * itself as the tree of rows, its stages open down to their tasks.
 *
 * The counts are the chain read's own, in scope `tree`: work in a state by its category, and
 * the goals and stages under it that derive a state of their own by what they derive, on a
 * line of their own, since «In progress» is said by both and one line would say it twice.
 * Then its tasks by project, a task of several projects in each, so that line adds up to no
 * total. Nothing is counted here.
 *
 * The rows are the tree of rows' (`treeRows`, `TreeRowLead`, `useListKeys`), the list's own
 * parts: one Tab stop, ↑ ↓ through the rows, → opens a folded row, ← folds an open one or goes
 * to its parent, and Enter or a press anywhere on a row opens its card. A row says its
 * reference and title, where it stands, and who holds it while it is open.
 *
 * Each row carries `data-id` and `data-reference`, and each count `data-count`: the state it
 * counts, or the project, `none` for no project.
 */
import { computed, nextTick, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { useContentsTree } from '@/widgets/work-item-inspector/utils/useContentsTree.ts'

import type { ChainMember, WorkItemChain } from '@/shared/api/planningChainApi.ts'
import { CONTAINER_STATES, STATE_CATEGORIES } from '@/shared/api/planningModel.ts'
import { holderName } from '@/shared/lib/actor.ts'
import { standingOf } from '@/shared/lib/standing.ts'
import { treeGridAttrs, treeRowAttrs } from '@/shared/lib/treeRows.ts'
import { useStandingName } from '@/shared/lib/useStateName.ts'
import DataEmptyState from '@/shared/ui/DataEmptyState.vue'
import SemanticState from '@/shared/ui/SemanticState.vue'
import { vSlashBreaks } from '@/shared/ui/slashBreaks.ts'
import { vTooltip } from '@/shared/ui/tooltipAnchors.ts'
import TreeRowLead from '@/shared/ui/TreeRowLead.vue'
import { useListKeys } from '@/shared/ui/useListKeys.ts'

const props = defineProps<{
  chain: WorkItemChain
  /** The space the root stands in: the reader's folds are kept by it. */
  space: string
}>()
const emit = defineEmits<{ open: [reference: string] }>()

const { t } = useI18n()
const standingName = useStandingName()

const tree = useContentsTree(
  () => props.chain.members,
  () => props.space,
)
const rows = computed(() => tree.rows.value)

/** The categories the work stands in, in the model's order, each with how much stands there. */
const byCategory = computed(() =>
  STATE_CATEGORIES.flatMap((category) => {
    const count = props.chain.by_category[category] ?? 0
    return count ? [{ count, label: t(`workItem.category.${category}`), state: category }] : []
  }),
)
/** What the goals and stages under it derive, in the order the work goes through them. */
const byContainer = computed(() =>
  CONTAINER_STATES.flatMap((state) => {
    const count = props.chain.by_container_state[state] ?? 0
    return count ? [{ count, label: t(`workItem.containerState.${state}`), state }] : []
  }),
)
/** The tasks by project, as the read orders them; a project the registry does not name by its id. */
const byProject = computed(() =>
  props.chain.by_project.map((row) => ({
    count: row.count,
    label:
      row.project_id === null
        ? t('workItem.chain.contents.noProject')
        : (row.display_name ?? row.project_id),
    project: row.project_id ?? 'none',
  })),
)
const countLines = computed(() =>
  [
    { key: 'category', label: t('workItem.chain.contents.byState'), counts: byCategory.value },
    { key: 'container', label: t('workItem.chain.group.containers'), counts: byContainer.value },
  ].filter((line) => line.counts.length > 0),
)

const root = ref<HTMLElement | null>(null)
const open = (reference: string) => emit('open', reference)
const keys = useListKeys(
  root,
  () => ({
    count: () => rows.value.length,
    heightAt: (index) =>
      root.value?.querySelector<HTMLElement>(`tbody tr:nth-child(${index + 1})`)?.offsetHeight ?? 0,
    idAt: (index) => rows.value[index]?.id,
    placeOf: tree.placeOf,
    reveal: () => false,
  }),
  open,
  { kind: 'row', tree },
)

const tabStop = (id: string) => keys.tabStop(id)
const toggle = (id: string) => keys.toggle(id)

/** Who holds an open member; finished work names nobody, as the chain's list does. */
const holder = (member: ChainMember) =>
  member.open && member.claim_ref ? holderName(member.claim_ref) : ''
const nameOf = (id: string, part: string) => `contents-${id}-${part}`

/** The row of a member, where it is shown, focused by Back; null where a fold hides it. */
async function reveal(reference: string): Promise<HTMLElement | null> {
  await nextTick()
  return (
    root.value?.querySelector<HTMLElement>(`tbody tr[data-reference="${CSS.escape(reference)}"]`) ??
    null
  )
}

defineExpose({ reveal })
</script>

<template>
  <div class="contents">
    <p
      v-for="line in countLines"
      :key="line.key"
      class="contents-counts"
      :data-counts="line.key"
    >
      <span class="contents-counts-label">{{ line.label }}</span>
      <span
        v-for="count in line.counts"
        :key="count.state"
        class="contents-count"
        :data-count="count.state"
      >
        <SemanticState
          dimension="work-item-state"
          :state="count.state"
          :label="count.label"
        />
        <span class="contents-count-value">{{ count.count }}</span>
      </span>
    </p>
    <p
      v-if="byProject.length > 0"
      class="contents-counts"
      data-counts="project"
    >
      <span class="contents-counts-label">{{ t('workItem.chain.contents.byProject') }}</span>
      <span
        v-for="count in byProject"
        :key="count.project"
        class="contents-count"
        :data-count="count.project"
      >
        <span class="contents-count-name">{{ count.label }}</span>
        <span class="contents-count-value">{{ count.count }}</span>
      </span>
    </p>

    <DataEmptyState
      v-if="rows.length === 0"
      :title="t('workItem.lanes.empty')"
      inline
    />
    <div
      v-else
      ref="root"
      class="contents-rows"
    >
      <table
        class="contents-table"
        :aria-label="t('workItem.chain.contents.table', { reference: chain.root.reference })"
        v-bind="treeGridAttrs({ rowCount: rows.length + 1, windowed: false })"
      >
        <!-- The columns' widths: a fixed table takes them from its first row, which here is
             the hidden head's, so they stand on the columns themselves. -->
        <colgroup>
          <col class="contents-col-work" />
          <col class="contents-col-state" />
          <col class="contents-col-holder" />
        </colgroup>
        <thead class="visually-hidden">
          <tr>
            <th scope="col">{{ t('workItem.chain.contents.work') }}</th>
            <th scope="col">{{ t('workItem.chain.contents.state') }}</th>
            <th scope="col">{{ t('workItem.chain.contents.holder') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in rows"
            :key="row.id"
            class="contents-row"
            v-bind="treeRowAttrs(row)"
            :aria-labelledby="`${nameOf(row.id, 'reference')} ${nameOf(row.id, 'title')}`"
            :data-id="row.id"
            :data-reference="row.item.reference"
            :tabindex="tabStop(row.id)"
          >
            <td
              class="contents-cell contents-work"
              tabindex="-1"
            >
              <span class="contents-work-line">
                <TreeRowLead
                  :depth="row.depth"
                  :expanded="row.expanded"
                  :name="row.item.reference"
                  @toggle="toggle(row.id)"
                />
                <span
                  :id="nameOf(row.id, 'reference')"
                  class="contents-reference"
                  >{{ row.item.reference }}</span
                >
                <span
                  :id="nameOf(row.id, 'title')"
                  v-tooltip.clipped="row.item.title"
                  v-slash-breaks="row.item.title"
                  class="contents-title one-line"
                />
              </span>
            </td>
            <td
              class="contents-cell contents-state"
              tabindex="-1"
            >
              <SemanticState
                dimension="work-item-state"
                :state="standingOf(row.item)"
                :label="standingName(row.item)"
              />
            </td>
            <td
              class="contents-cell contents-holder"
              tabindex="-1"
            >
              <span
                v-if="holder(row.item)"
                v-tooltip.clipped="holder(row.item)"
                class="contents-holder-name one-line"
                >{{ holder(row.item) }}</span
              >
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.contents {
  display: grid;
  gap: var(--space-3);
  min-width: 0;
  container: chain-contents / inline-size;
}

/* A line of counts, each a state's dot and word with its figure, wrapping between counts
   and never inside one. */
.contents-counts {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1) var(--space-4);
  align-items: center;
  margin: 0;
  font: var(--font-detail);
  font-variant-numeric: tabular-nums;
}

.contents-counts-label {
  color: var(--color-text-muted);
}

.contents-count {
  display: inline-flex;
  gap: var(--space-1);
  align-items: center;
  white-space: nowrap;
}

.contents-count-name {
  color: var(--color-text);
}

.contents-count-value {
  color: var(--color-text);
  font-weight: 500;
}

.contents-table {
  width: 100%;
  table-layout: fixed;
  border-collapse: collapse;
}

.contents-row {
  color: var(--color-text);
  font: var(--font-line);
  cursor: pointer;

  &:hover {
    background: var(--color-surface-hover);
  }

  &:focus-visible {
    outline: var(--size-focus-ring) solid var(--color-focus-ring);
    outline-offset: -2px;
  }
}

.contents-cell {
  vertical-align: middle;
  min-height: var(--size-control-inline);
  padding: var(--space-1) var(--space-2);

  &:focus-visible {
    outline: var(--size-focus-ring) solid var(--color-focus-ring);
    outline-offset: -2px;
  }
}

.contents-col-work {
  width: 54%;
}

.contents-work-line {
  display: flex;
  gap: var(--space-2);
  align-items: center;
  min-width: 0;
}

.contents-reference {
  flex: none;
  color: var(--color-text-muted);
  font-variant-numeric: tabular-nums;
}

.contents-title {
  min-width: 0;
}

.contents-col-state {
  width: 26%;
}

.contents-col-holder {
  width: 20%;
}

/* The holder's name is cut at its column's edge, whole in its hint. */
.contents-holder-name {
  display: block;
}

.contents-holder {
  color: var(--color-text-tertiary);
  font: var(--font-detail);
}

/* At a phone's width the holder gives way, as the chain's list lets it go, and the card
   names it. */
@container chain-contents (width < 480px) {
  .contents-col-work {
    width: 64%;
  }

  .contents-col-state {
    width: 36%;
  }

  .contents-col-holder {
    width: 0;
  }

  .contents-holder {
    display: none;
  }
}
</style>
