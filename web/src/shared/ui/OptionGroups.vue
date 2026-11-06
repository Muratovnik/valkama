<script setup lang="ts">
/**
 * A list of options in named groups, any number of them chosen: the popup a
 * one-line field drives (`VTextInput` with `completion`).
 *
 * It never takes focus. The field keeps the caret, so typing goes on narrowing
 * the list, and names the highlighted row through `aria-activedescendant`; a
 * pointer press anywhere on it, a group's name included, is kept from stealing
 * the caret for the same reason. The host places it: this draws the surface, not
 * where it stands.
 *
 * A group may offer choices about the group itself in its head, which stays in
 * sight while its values scroll. A list holds options and nothing else, and a
 * second focus would take the caret from the field, so they are options too: the
 * arrows reach them first in the group, and each says in its own name what it is.
 *
 * Such a group stands last, because its head holds the whole list for its own: while
 * the group is still below the fold the head waits at the list's lower edge, so what it
 * offers is in sight as the list opens, however many values stand above it.
 */
import { computed } from 'vue'

import { optionGroupItemId } from '@/shared/ui/choiceControls.ts'
import VIcon from '@/shared/ui/VIcon.vue'

interface OptionGroup {
  id: string
  name: string
  options: readonly {
    key: string
    selected: boolean
    text: string
    detail?: string
    /** The option names a work item kind, and its word takes that kind's colour. */
    kind?: string
  }[]
  choices?: readonly {
    key: string
    name: string
    selected: boolean
    text: string
    title: string
  }[]
}

const props = defineProps<{
  groups: readonly OptionGroup[]
  /** The highlighted option by its place in reading order; -1 for none. */
  highlight: number
  id: string
  label: string
}>()

const emit = defineEmits<{
  'choose': [key: string]
  'update:highlight': [place: number]
}>()

/** The DOM id of an option by its place in reading order, which the arrows walk. */
const optionId = (place: number) => optionGroupItemId(props.id, place)

const rows = computed(() => {
  let place = 0
  return props.groups.map((group) => ({
    group,
    headingId: `${props.id}-group-${group.id}`,
    choices: (group.choices ?? []).map((option) => ({ option, place: place++ })),
    options: group.options.map((option) => ({ option, place: place++ })),
  }))
})

/** Absent rather than false: the attribute is what the style reads. */
const highlighted = (place: number) => place === props.highlight || undefined
</script>

<template>
  <div
    :id="id"
    class="option-groups"
    role="listbox"
    aria-multiselectable="true"
    :aria-label="label"
    @pointerdown.prevent
  >
    <div
      v-for="row in rows"
      :key="row.group.id"
      class="option-group"
      role="group"
      :aria-labelledby="row.headingId"
    >
      <div class="option-group-head">
        <div
          :id="row.headingId"
          class="option-group-name"
          role="presentation"
        >
          {{ row.group.name }}
        </div>
        <div
          v-if="row.choices.length"
          class="option-choices"
        >
          <div
            v-for="entry in row.choices"
            :id="optionId(entry.place)"
            :key="entry.option.key"
            class="option-choice"
            role="option"
            tabindex="-1"
            :aria-label="entry.option.name"
            :aria-selected="entry.option.selected"
            :data-highlighted="highlighted(entry.place)"
            :title="entry.option.title"
            @pointermove="emit('update:highlight', entry.place)"
            @click="emit('choose', entry.option.key)"
            @keydown.enter="emit('choose', entry.option.key)"
          >
            {{ entry.option.text }}
          </div>
        </div>
      </div>
      <div
        v-for="entry in row.options"
        :id="optionId(entry.place)"
        :key="entry.option.key"
        class="option-row"
        role="option"
        tabindex="-1"
        :aria-selected="entry.option.selected"
        :data-highlighted="highlighted(entry.place)"
        @pointermove="emit('update:highlight', entry.place)"
        @click="emit('choose', entry.option.key)"
        @keydown.enter="emit('choose', entry.option.key)"
      >
        <VIcon
          class="option-check"
          name="check"
          :size="14"
        />
        <span
          class="option-text"
          :data-kind="entry.option.kind"
          >{{ entry.option.text }}</span
        >
        <span
          v-if="entry.option.detail"
          class="option-detail"
          >{{ entry.option.detail }}</span
        >
      </div>
    </div>
  </div>
</template>

<style scoped>
/* The choice list's surface: the overlay edge is the one line it draws. */
.option-groups {
  max-height: var(--size-option-groups-max-height);
  padding: var(--space-1);
  border: 1px solid var(--color-rule-strong);
  background: var(--color-surface);
  overflow-y: auto;
  overscroll-behavior: contain;
  scroll-padding-top: calc(var(--size-control-inline) + var(--space-1));
  border-radius: var(--radius-control);
  box-shadow: 0 14px 34px var(--color-shadow);
}

/* A row the arrows reach stops short of a head waiting at the lower edge, too. */
.option-groups:has(.option-choices) {
  scroll-padding-bottom: calc(var(--size-control-inline) + var(--space-1));
}

.option-group + .option-group {
  margin-top: var(--space-1);
}

/* It stays in sight while its group scrolls under it, up to the surface's edge. */
.option-group-head {
  position: sticky;
  top: calc(-1 * var(--space-1));
  z-index: 1;
  display: flex;
  gap: var(--space-2);
  justify-content: space-between;
  align-items: center;
  background: var(--color-surface);
}

/* With no box of its own the group leaves its head the list to stick in, at both edges. A sticky
   box cannot leave what contains it, and a head inside its group could not rise above the group's
   own top to wait at the edge. The group is still the group its options are read out in. */
.option-group:has(.option-choices) {
  display: contents;

  .option-group-head {
    bottom: calc(-1 * var(--space-1));
    margin-top: var(--space-1);
  }
}

.option-group-name {
  padding: var(--space-1) var(--space-2) var(--space-half);
  color: var(--color-text-tertiary);
  font: var(--font-label);
}

/* A pressed segment's look, as a choice among two is: a track and its chosen word. */
.option-choices {
  display: inline-flex;
  flex: 0 0 auto;
  gap: var(--space-half);
  padding: var(--space-half);
  background: var(--color-surface-muted);
  border-radius: var(--radius-control);

  /* A forced palette clears the track, and the choice not taken read as a word beside it. */
  @media (forced-colors: active) {
    outline: 1px solid ButtonText;
    outline-offset: -1px;
  }
}

.option-choice {
  display: flex;
  align-items: center;
  min-height: calc(var(--size-control-inline) - 2 * var(--space-half));
  padding: 0 var(--space-2);
  color: var(--color-text-muted);
  font: var(--font-detail);
  border-radius: calc(var(--radius-control) - var(--space-half));
  cursor: pointer;

  &:hover {
    color: var(--color-text);
  }

  &[aria-selected='true'] {
    color: var(--color-text);
    font-weight: 600;
    background: var(--color-surface-active);

    @media (forced-colors: active) {
      color: HighlightText;
      background: Highlight;
      forced-color-adjust: none;
    }
  }

  &[data-highlighted] {
    outline: 1px solid var(--color-focus-ring);
    outline-offset: -1px;
  }
}

.option-row {
  display: flex;
  gap: var(--space-2);
  align-items: center;
  min-height: var(--size-control-inline);
  padding: 0 var(--space-2);
  color: var(--color-text);
  font: var(--font-detail);
  border-radius: var(--radius-control);
  cursor: pointer;

  &[data-highlighted] {
    background: var(--color-surface-hover);
    outline: 1px solid var(--color-focus-ring);
    outline-offset: -1px;
  }
}

/* The check holds its place on every row, so the words line up. */
.option-check {
  flex: 0 0 auto;
  visibility: hidden;

  .option-row[aria-selected='true'] & {
    visibility: visible;
  }
}

/* The words take what they need and no more, so a count stands beside what it counts. Grown to
   the row's end, they sent the count to the menu's far edge, 230px from its label. */
.option-text {
  flex: 0 1 auto;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;

  &[data-kind] {
    color: var(--color-kind-ink);
  }
}

.option-detail {
  flex: 0 0 auto;
  color: var(--color-text-tertiary);
  font-variant-numeric: tabular-nums;
}
</style>
