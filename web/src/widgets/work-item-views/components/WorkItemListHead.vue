<script setup lang="ts">
/**
 * The list's head: one sort per shown column, and the sorts of the columns
 * folded under the title on the title's heading.
 *
 * Where only a few columns fold, their sorts follow the title's as a run of
 * buttons set apart by dots. Where most of them fold, that run took three lines
 * of a phone's width and a dot began two of them, so the folded sorts become one
 * compact choice beside the title's sort. A chosen order is turned over from the
 * same choice, as a second click on a heading turns its order over: a button of
 * its own cost the width the order's name needed, and the name came out cut.
 * Every order the wide list offers stays one choice away. A name never ends in an
 * ellipsis while a line of its own would hold it whole.
 *
 * The head's controls are out of the Tab order: the rows are the list's one Tab
 * stop, and the keys reach the head from them (`useListKeys.ts`).
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { fitOf, sortsChosen } from '@/widgets/work-item-views/utils/listColumns.ts'
import type { Level, ListColumn, SortKey } from '@/widgets/work-item-views/utils/listColumns.ts'
import { nextSort } from '@/widgets/work-item-views/utils/workOrder.ts'
import type { ViewSort, ViewSortKey } from '@/widgets/work-item-views/utils/workOrder.ts'

import ChoiceSelect from '@/shared/ui/ChoiceSelect.vue'
import VIcon from '@/shared/ui/VIcon.vue'

const props = defineProps<{
  columns: readonly ListColumn[]
  folded: readonly ListColumn[]
  /** The list's level, which decides how the folded sorts are offered and whether they wrap. */
  level: Level
  /** The order in force: by a column's key, or by one no column shows, such as the queue's. */
  sort: ViewSort
}>()

/** The order a sort asks for, which the list's host keeps. */
const emit = defineEmits<{ sort: [sort: ViewSort] }>()
const { t } = useI18n()

/** The folded sorts as one choice rather than a run of buttons. */
const choice = computed(() => sortsChosen(fitOf(props.level)))
/**
 * Whether the choice shows its chevron alone, its name in its hint and to assistive technology,
 * and the title's heading may take a second line: only in the last level, which no other gives
 * way to. In every other a heading too long for its column pushes the table past the list, and
 * the level gives way (`useListFit.ts`).
 */
const bare = computed(() => props.level === 'bare')
const sortKey = computed(() => props.sort.key)
const descending = computed(() => props.sort.descending)
const sortState = (key: SortKey) => {
  if (props.sort.key !== key) return 'none'
  return props.sort.descending ? 'descending' : 'ascending'
}
/** One press sorts by a column from the end it reads first; a second turns it over. */
const sortBy = (key: ViewSortKey) => emit('sort', nextSort(props.sort, key))

/**
 * A column that sorts numerically must carry the mark and every other column must
 * not carry it at all — `data-numeric="false"` styles as a truthy attribute
 * selector, which is how the text columns once came out right-aligned.
 */
const numericMark = (column: { numeric?: boolean }) => (column.numeric ? 'true' : undefined)
const holdsTitle = (column: ListColumn) => column.key === 'title'

/** The sorts a heading offers as buttons: its own, and on the title's those folded under it. */
function sortsIn(column: ListColumn): readonly ListColumn[] {
  return !holdsTitle(column) || choice.value ? [column] : [column, ...props.folded]
}

function headClass(column: ListColumn) {
  return {
    'list-head-title': holdsTitle(column),
    'list-head-reference': column.key === 'reference',
  }
}

/** A sort a heading carries for a column folded under it, rather than its own. */
function sortClass(sort: ListColumn, column: ListColumn) {
  return { folded: sort.key !== column.key }
}

/** Not a column's key, so it can never be the chosen order. */
const TURN = 'turn'

const chosen = computed(() =>
  props.folded.some((column) => column.key === sortKey.value) ? sortKey.value : '',
)
const choices = computed(() => {
  const columns = props.folded.map((column) => ({ label: t(column.label), value: column.key }))
  if (!chosen.value) return columns
  const turn = descending.value ? 'workItem.list.sortAscending' : 'workItem.list.sortDescending'
  return [...columns, { label: t(turn), value: TURN }]
})

function choose(value: string) {
  if (value === TURN) {
    sortBy(sortKey.value)
    return
  }
  const column = props.folded.find((each) => each.key === value)
  if (column) sortBy(column.key)
}
</script>

<template>
  <thead>
    <tr
      aria-rowindex="1"
      :class="{ choice, wraps: bare }"
    >
      <th
        v-for="column in columns"
        :key="column.key"
        scope="col"
        class="list-head"
        :class="headClass(column)"
        :aria-sort="sortState(column.key)"
        :data-numeric="numericMark(column)"
      >
        <span class="list-sorts">
          <button
            v-for="offered in sortsIn(column)"
            :key="offered.key"
            type="button"
            class="list-sort"
            tabindex="-1"
            :class="sortClass(offered, column)"
            @click="sortBy(offered.key)"
          >
            {{ t(offered.label) }}
            <VIcon
              v-if="sortKey === offered.key"
              name="chevron-down"
              class="list-sort-mark"
              :class="{ ascending: !descending }"
              :size="14"
            />
          </button>
          <ChoiceSelect
            v-if="choice && holdsTitle(column) && folded.length"
            class="list-sort-choice"
            size="heading"
            :label="t('workItem.list.sortBy')"
            :placeholder="t('workItem.list.sortOther')"
            :model-value="chosen"
            :options="choices"
            :bare="bare"
            keyed
            @update:model-value="choose"
          />
        </span>
      </th>
    </tr>
  </thead>
</template>

<style scoped>
/* The head stays while the rows move, because a sorted column with its label
   scrolled away is a column of unexplained values. Every column but the title
   is as wide as what it holds; the title takes the rest. */
.list-head {
  position: sticky;
  top: 0;
  z-index: 1;
  vertical-align: bottom;
  width: 1%;
  padding: 0;
  text-align: start;
  white-space: nowrap;
  background: var(--color-surface);

  &[data-numeric='true'] {
    text-align: end;
  }
}

.list-head-title {
  width: auto;
  white-space: normal;
}

/* The longest order may take a line of its own under the title's sort, and the
   other sorts stay on the first line. */
.choice .list-head {
  vertical-align: top;
}

/* A heading's sorts: one, or on the title's heading the title's and those of
   the columns folded under it, side by side on one line. */
.list-sorts {
  display: flex;
  align-items: center;

  .wraps & {
    flex-wrap: wrap;
  }

  .list-head[data-numeric='true'] & {
    justify-content: flex-end;
  }
}

.list-sort {
  display: inline-flex;
  flex: 1 1 auto;
  gap: var(--space-1);
  align-items: center;
  padding: var(--space-2) var(--space-list-inset);
  border: 0;
  color: var(--color-text-muted);
  font: var(--font-column-head);
  text-align: inherit;
  white-space: nowrap;
  background: none;
  cursor: pointer;

  &:hover,
  &:focus-visible {
    color: var(--color-text);
  }

  .list-head[data-numeric='true'] & {
    justify-content: flex-end;
  }

  .list-sorts:has(> :nth-child(2)) > & {
    flex: 0 0 auto;
  }

  /* The choice beside the title's sort is a filled control with an inset of
     its own, so the sort's inset on that side is spent twice. */
  .list-sorts:has(.list-sort-choice) > & {
    padding-inline-end: var(--space-half);
  }

  /* The sorts of the folded columns follow the title's own as one run, in the
     order their facts take under the title, set apart by a dot that is not
     part of any name. */
  &.folded {
    padding-inline: var(--space-1);

    &::before {
      content: '·' / '';
      padding-inline-end: var(--space-1);
    }
  }
}

/* The reference's heading starts over the reference rather than over the
   glyphs that lead it, at the start the list declares; it is the cell's inset
   where no list declares one. A sort's inset is the list's cells'
   (`--space-list-inset`), so a heading's word starts where its column's words do. */
.list-head-reference > .list-sorts > .list-sort {
  padding-inline-start: max(var(--space-list-inset), var(--list-reference-start, 0px));
}

/* An order's name is never cut: a heading too narrow for the choice pushes the table past the
   list, which gives way to a level where it stands, at the last bare (`useListFit.ts`). */
.list-sort-choice {
  flex: none;
  min-width: max-content;
}

/* One chevron, turned over. The icon set holds no upward chevron, and adding a
   second glyph to say the opposite of the first is how two marks for one idea
   start to disagree. */
.list-sort-mark.ascending {
  transform: rotate(180deg);
}
</style>
