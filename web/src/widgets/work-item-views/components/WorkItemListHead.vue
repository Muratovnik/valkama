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
 * Every order the wide list offers stays one choice away.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import type { ListColumn, SortKey } from '@/widgets/work-item-views/utils/listColumns.ts'

import ChoiceSelect from '@/shared/ui/ChoiceSelect.vue'
import VIcon from '@/shared/ui/VIcon.vue'

const props = defineProps<{
  columns: readonly ListColumn[]
  descending: boolean
  folded: readonly ListColumn[]
  /** The folded sorts as one choice rather than a run of buttons. */
  narrow: boolean
  sortKey: SortKey
  sortState: (key: SortKey) => 'ascending' | 'descending' | 'none'
}>()

const emit = defineEmits<{ sort: [key: SortKey] }>()
const { t } = useI18n()

/**
 * A column that sorts numerically must carry the mark and every other column must
 * not carry it at all — `data-numeric="false"` styles as a truthy attribute
 * selector, which is how the text columns once came out right-aligned.
 */
const numericMark = (column: { numeric?: boolean }) => (column.numeric ? 'true' : undefined)
const holdsTitle = (column: ListColumn) => column.key === 'title'

/** The sorts a heading offers as buttons: its own, and on the title's those folded under it. */
function sortsIn(column: ListColumn): readonly ListColumn[] {
  return !holdsTitle(column) || props.narrow ? [column] : [column, ...props.folded]
}

function headClass(column: ListColumn) {
  return { 'list-head-title': holdsTitle(column) }
}

/** A sort a heading carries for a column folded under it, rather than its own. */
function sortClass(sort: ListColumn, column: ListColumn) {
  return { folded: sort.key !== column.key }
}

/** Not a column's key, so it can never be the chosen order. */
const TURN = 'turn'

const chosen = computed(() =>
  props.folded.some((column) => column.key === props.sortKey) ? props.sortKey : '',
)
const choices = computed(() => {
  const columns = props.folded.map((column) => ({ label: t(column.label), value: column.key }))
  if (!chosen.value) return columns
  const turn = props.descending ? 'workItem.list.sortAscending' : 'workItem.list.sortDescending'
  return [...columns, { label: t(turn), value: TURN }]
})

function choose(value: string) {
  if (value === TURN) {
    emit('sort', props.sortKey)
    return
  }
  const column = props.folded.find((each) => each.key === value)
  if (column) emit('sort', column.key)
}
</script>

<template>
  <thead>
    <tr :class="{ narrow }">
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
            v-for="sort in sortsIn(column)"
            :key="sort.key"
            type="button"
            class="list-sort"
            :class="sortClass(sort, column)"
            @click="emit('sort', sort.key)"
          >
            {{ t(sort.label) }}
            <VIcon
              v-if="sortKey === sort.key"
              name="chevron-down"
              class="list-sort-mark"
              :class="{ ascending: !descending }"
              :size="14"
            />
          </button>
          <ChoiceSelect
            v-if="narrow && holdsTitle(column) && folded.length"
            class="list-sort-choice"
            size="compact"
            :label="t('workItem.list.sortBy')"
            :placeholder="t('workItem.list.sortOther')"
            :model-value="chosen"
            :options="choices"
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

/* A heading's sorts: one, or on the title's heading the title's and those of
   the columns folded under it, side by side. */
.list-sorts {
  display: flex;
  flex-wrap: wrap;
  align-items: center;

  .list-head[data-numeric='true'] & {
    justify-content: flex-end;
  }

  /* The choice gives up its width before anything wraps: a long order name
     ends in an ellipsis rather than starting a second line. */
  &:has(.list-sort-choice) {
    flex-wrap: nowrap;
  }
}

.list-sort {
  display: inline-flex;
  flex: 1 1 auto;
  gap: var(--space-1);
  align-items: center;
  padding: var(--space-2) var(--space-3);
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

  /* On a phone the sorts give up half their inset, which is the width the
     longest order's name needs beside the title's. */
  .narrow & {
    padding-inline: var(--space-2);
  }

  /* The choice beside the title's sort is a filled control with an inset of
     its own, so the sort's inset on that side is spent twice. */
  .list-sorts:has(.list-sort-choice) > & {
    padding-inline-end: var(--space-1);
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

.list-sort-choice {
  flex: 0 1 auto;
}

/* One chevron, turned over. The icon set holds no upward chevron, and adding a
   second glyph to say the opposite of the first is how two marks for one idea
   start to disagree. */
.list-sort-mark.ascending {
  transform: rotate(180deg);
}
</style>
