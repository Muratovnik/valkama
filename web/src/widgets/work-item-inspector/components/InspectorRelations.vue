<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import InspectorEvidence from '@/widgets/work-item-inspector/components/InspectorEvidence.vue'
import RelatedWorkPicker from '@/widgets/work-item-inspector/components/RelatedWorkPicker.vue'

import { linkWorkItems, planningRefusal } from '@/shared/api/planningApi.ts'
import { LINK_KINDS } from '@/shared/api/planningModel.ts'
import type { WorkItem } from '@/shared/api/planningModel.ts'
import { useStateName } from '@/shared/lib/useStateName.ts'
import DataEmptyState from '@/shared/ui/DataEmptyState.vue'
import SectionHeader from '@/shared/ui/SectionHeader.vue'
import SemanticState from '@/shared/ui/SemanticState.vue'
import { vSlashBreaks } from '@/shared/ui/slashBreaks.ts'
import { vTooltip } from '@/shared/ui/tooltipAnchors.ts'
import VButton from '@/shared/ui/VButton.vue'
import VDisclosure from '@/shared/ui/VDisclosure.vue'
import VIcon from '@/shared/ui/VIcon.vue'

const props = defineProps<{
  item: WorkItem
  writable: boolean
}>()
const emit = defineEmits<{
  changed: []
  open: [reference: string]
}>()
/** The groups the reader opened or folded, by key; a group not named keeps its first state. */
const opened = defineModel<Record<string, boolean>>('opened', { default: () => ({}) })
const { t } = useI18n()
type Link = WorkItem['links'][number]
type Group = { key: string; links: Link[] }

const stateName = useStateName()
/** The other end's state as the owner has states named; drawn only where the server named it. */
function linkState(link: Link): string {
  return stateName({ name: link.state_name ?? '', category: link.state_category ?? undefined })
}

/**
 * Kinds whose two directions mean the same thing. A link is stored once, from
 * the item its author was looking at, so "relates to" arrived as two groups
 * under one heading each — the same words twice, the rows split by an accident
 * of who wrote them.
 */
const SYMMETRIC: ReadonlySet<Link['kind']> = new Set(['relates-to'])

const pickerOpen = ref(false)
const busy = ref(false)
const error = ref('')
const groups = computed(() =>
  LINK_KINDS.flatMap((kind) => {
    const directions = SYMMETRIC.has(kind)
      ? [{ key: kind, label: t(`workItem.relation.${kind}.outgoing`), match: () => true }]
      : (['outgoing', 'incoming'] as const).map((direction) => ({
          key: `${kind}-${direction}`,
          label: t(`workItem.relation.${kind}.${direction}`),
          match: (link: Link) => link.direction === direction,
        }))
    return directions
      .map((group) => ({
        key: group.key,
        label: group.label,
        links: props.item.links.filter((link) => link.kind === kind && group.match(link)),
      }))
      .filter((group) => group.links.length)
  }),
)

/**
 * A group of more than five links opens folded to its heading, which counts them by state,
 * so the groups after it and the references stand within reach; a shorter group opens. An
 * epic's fourteen «Led to» rows held everything under them a long scroll away.
 */
const FOLD_PAST = 5
const isOpen = (group: Group) => opened.value[group.key] ?? group.links.length <= FOLD_PAST
function setOpen(group: Group, open: boolean) {
  opened.value = { ...opened.value, [group.key]: open }
}
/** How many of a group's links stand in each state the server named, the most common first. */
function stateCounts(group: Group): string {
  const counts = new Map<string, number>()
  for (const link of group.links) {
    if (!link.state_category || !link.state_name) continue
    const name = linkState(link)
    counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  return [...counts]
    .sort((one, other) => other[1] - one[1])
    .map(([name, count]) => `${count} ${name.toLocaleLowerCase()}`)
    .join(' · ')
}
function add() {
  if (!props.writable || busy.value) return
  pickerOpen.value = true
}
async function remove(link: Link) {
  if (!props.writable || busy.value) return
  busy.value = true
  error.value = ''
  try {
    await linkWorkItems({
      id: link.direction === 'incoming' ? link.work_item_id : props.item.work_item_id,
      other: link.direction === 'incoming' ? props.item.work_item_id : link.work_item_id,
      kind: link.kind,
      remove: true,
    })
    emit('changed')
  } catch (error_) {
    error.value =
      planningRefusal(error_)?.message ??
      (error_ instanceof Error ? error_.message : String(error_))
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="relations">
    <section class="relation-section">
      <SectionHeader
        :title="t('workItem.links')"
        :count="item.links.length || ''"
      >
        <template
          v-if="writable"
          #actions="{ size }"
        >
          <VButton
            v-tooltip.name="t('workItem.related.add')"
            variant="ghost"
            :size="size"
            :aria-label="t('workItem.related.add')"
            :disabled="busy"
            icon
            @click="add"
          >
            <VIcon name="plus" />
          </VButton>
        </template>
      </SectionHeader>
      <p
        v-if="error"
        class="relation-error"
        role="alert"
      >
        {{ error }}
      </p>
      <div
        v-if="groups.length"
        class="link-groups"
      >
        <VDisclosure
          v-for="group in groups"
          :key="group.key"
          class="relation-group"
          heading="h4"
          :open="isOpen(group)"
          subgrid
          @update:open="(open) => setOpen(group, open)"
        >
          <template #summary>
            {{ group.label }}
            <span class="group-count">{{ group.links.length }}</span>
            <!-- The space is the toggle's name's, which the row's gap does not give it. -->
            <span
              v-if="!isOpen(group) && stateCounts(group)"
              class="group-states"
              >{{ ` · ${stateCounts(group)}` }}</span
            >
          </template>
          <ul class="link-list">
            <li
              v-for="link in group.links"
              :key="`${link.direction}-${link.work_item_id}`"
              class="link-row"
            >
              <button
                class="link-open"
                type="button"
                @click="emit('open', link.reference)"
              >
                <span class="link-reference">{{ link.reference }}</span>
                <span
                  v-slash-breaks="link.title"
                  class="link-title"
                />
                <!-- The other end's state, when the server could say it: a finished blocker reads as finished. -->
                <SemanticState
                  v-if="link.state_category && link.state_name"
                  class="link-state"
                  variant="inline"
                  dimension="work-item-state"
                  :state="link.state_category"
                  :label="linkState(link)"
                />
              </button>
              <VButton
                v-if="writable"
                v-tooltip.name="t('workItem.unlink')"
                class="link-remove"
                variant="ghost"
                size="inline"
                :disabled="busy"
                :aria-label="t('workItem.related.remove', { reference: link.reference })"
                icon
                @click="remove(link)"
              >
                <VIcon
                  name="close"
                  :size="16"
                />
              </VButton>
            </li>
          </ul>
        </VDisclosure>
      </div>
      <DataEmptyState
        v-if="!groups.length"
        :title="t('workItem.noLinks')"
        inline
      />
      <RelatedWorkPicker
        :key="item.work_item_id"
        initial-kind="relates-to"
        initial-direction="outgoing"
        :item="item"
        :writable="writable"
        :open="pickerOpen"
        @close="pickerOpen = false"
        @changed="emit('changed')"
        @open="emit('open', $event)"
      />
    </section>

    <InspectorEvidence :item="item" />
  </div>
</template>
<style scoped>
.relations {
  display: grid;
  gap: var(--space-section);
}

.relation-section {
  display: grid;
  gap: var(--space-heading-content);
}

/* One column set for every group of links, which the groups, their rows and each row's
   button subgrid: the reference, the title, the other end's state and the remove. An
   ordinary reference fills its column, so titles start on one line down the list, and a
   longer key widens the column for every row rather than moving its own title alone. A
   group folds, so it is a disclosure, and it passes the columns on to the rows it opens:
   with columns of its own each group put the state at another edge, 9 to 20px apart. */
.link-groups {
  display: grid;
  grid-template-columns: minmax(8ch, max-content) minmax(0, 1fr) auto auto;
  gap: var(--space-heading-content) var(--space-2);
  min-width: 0;
  container: link-groups / inline-size;
}

/* A group is a caption over its rows, and the rows hang directly under it: the caption
   and its count are one line of the group heading's type, in the ink every disclosure's
   words wear, and a folded group's states follow in the quieter detail. */
.relation-group {
  --font-disclosure: var(--font-group-heading);
  --space-disclosure-gap: var(--space-1);
}

.group-states {
  color: var(--color-text-tertiary);
  font: var(--font-detail);
}

.group-count {
  font-variant-numeric: tabular-nums;
}

.relation-error {
  margin: 0;
  color: var(--color-danger);
  font: var(--font-detail);
}

.link-list {
  display: grid;
  grid-template-columns: subgrid;
  grid-column: 1 / -1;
  padding: 0;
  margin: 0;
  list-style: none;
}

/* The row's one action has the last column, so every remove stands at the same edge
   instead of wherever the title happened to end. */
.link-row {
  display: grid;
  grid-template-columns: subgrid;
  grid-column: 1 / -1;
  align-items: start;
}

.link-open {
  display: grid;
  grid-template-columns: subgrid;
  grid-column: 1 / 4;
  row-gap: var(--space-half);
  align-items: baseline;
  min-width: 0;
  padding: var(--space-1) 0;
  border: 0;
  color: inherit;
  text-align: start;
  background: none;
  cursor: pointer;
}

.link-reference {
  color: var(--color-text-muted);
  font: var(--font-line);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.link-title {
  color: var(--color-text);
  font: var(--font-note);
  overflow-wrap: anywhere;

  .link-open:is(:hover, :focus-visible) & {
    text-decoration: underline;
  }
}

/* The other end's state stands in one place on every row, whatever the title's length: in
   its own column on the title's first line, every dot on one edge. It followed the title in
   a row that wrapped, so it ended a short title's line and stood under a long one, and down
   a list it jumped between the two. A name longer than the column's room ends in an ellipsis
   and says itself whole in a hint, so one renamed state does not take every title's room. */
.link-open .link-state {
  justify-self: start;
  max-inline-size: 18ch;
}

/* A phone's list has no room for that column beside a title: it left titles 128px of 341.
   There the state stands under every title, at its edge. */
@container link-groups (width < 480px) {
  .link-title {
    grid-column: 2 / 4;
  }

  .link-open .link-state {
    grid-row: 2;
    grid-column: 2 / 4;
    max-inline-size: 100%;
  }
}
</style>
