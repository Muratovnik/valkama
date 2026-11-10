<script setup lang="ts">
/**
 * What a row of the side panel's list says, and the box a press on it lands in (`NavWorkRow`):
 * the item's number or the session's glyph, its title, how many agents are on it, and on a row
 * of the work to follow now a second line under the title. An item's is a link to its card,
 * a session's a button; the row gives it its tag, its address or busy state and its press.
 *
 * The number's column is as wide as the list's longest number and the session's glyph, so
 * the titles start at one x and the second lines under them. The epic's title is the row's
 * context, not its name: on one line it gives way first, never taking more than two fifths of
 * the room, and the row's own title keeps the rest.
 *
 * Its inks are the row's (`NavWorkRow`): the words beside the title take `--nav-row-aside-ink`
 * and the title `--nav-row-title-ink`, muted by default and the title the row's own colour.
 */
import { computed } from 'vue'

import VIcon from '@/shared/ui/VIcon.vue'

const props = defineProps<{
  /** The state, how long and where the row belongs; empty on a row of one line. */
  detail: string
  /** The parent's title before the row's own, on a row of one line. */
  epic: string | null
  /** A session's row: its glyph stands where an item's number does. */
  glyph: boolean
  /** A closed item's state, or how many agents are on the row. */
  meta: { agents: boolean; word: string } | null
  number: string
  tag: 'a' | 'button'
  title: string
  /** A number as wide as the list's longest, which sizes the number's column. */
  widest: string
}>()

/** How many letters the epic's title has: a short one keeps no more room than its letters. */
const epicStyle = computed(() => ({ '--nav-row-epic-letters': `${props.epic?.length ?? 0}ch` }))
</script>

<template>
  <component
    :is="tag"
    class="nav-row-link"
  >
    <span class="nav-row-numeral">
      <VIcon
        v-if="glyph"
        class="nav-row-glyph"
        name="terminal"
        :size="12"
      />
      <span
        v-else
        class="nav-row-number trimmed-word"
        >{{ number }}</span
      >
      <span
        class="nav-row-widest trimmed-word"
        aria-hidden="true"
        >{{ widest }}</span
      >
    </span>
    <span class="nav-row-words">
      <template v-if="epic">
        <span
          class="nav-row-epic trimmed-word one-line"
          :style="epicStyle"
          >{{ epic }}</span
        >
        <span
          class="nav-row-epic-mark trimmed-word"
          aria-hidden="true"
          >›</span
        >
      </template>
      <span class="nav-row-title trimmed-word one-line">{{ title }}</span>
      <span
        v-if="meta"
        class="nav-row-meta"
        aria-hidden="true"
      >
        <VIcon
          v-if="meta.agents"
          name="agent"
          :size="12"
        /><span class="trimmed-word">{{ meta.word }}</span>
      </span>
    </span>
    <span
      v-if="detail"
      class="nav-row-detail one-line"
      aria-hidden="true"
      >{{ detail }}</span
    >
  </component>
</template>

<style scoped>
/* The link's box is the whole row, so the row opens wherever it is pressed; the controls at
   the end stand over it. Its ring is the row's, inside it, and only from the keyboard. Its
   first line is the number's column and the words, as tall as the row's first line
   (`--nav-row-line`); its second line starts under the words. Its words are trimmed to their
   capitals (`.trimmed-word`), so the capitals' middle is the first line's, where the lead's
   sign stands: centred as lines, they stood up to a pixel over the sign. A session's row is a
   button, which takes no text and no height of its own: the row's line sets it. */
.nav-row-link {
  display: grid;
  grid-template-rows: var(--nav-row-line);
  grid-template-columns: auto minmax(0, 1fr);
  column-gap: var(--space-2);
  align-items: center;
  min-width: 0;
  min-block-size: 0;
  padding: 0;
  border: 0;
  color: inherit;
  font: var(--font-detail);
  text-align: start;
  text-decoration: none;
  background: none;
  cursor: pointer;

  &::before {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: var(--radius-control);
  }

  &:focus-visible {
    outline: none;

    &::before {
      outline: var(--size-focus-ring) solid var(--color-focus-ring);
      outline-offset: -2px;
    }
  }
}

.nav-row-words {
  display: flex;
  gap: var(--space-2);
  align-items: center;
  min-width: 0;
}

/* The number over an unseen one as long as the list's longest, in figures of one width, so
   the column is that wide on every row and a title starts at the same x whatever the length
   of the number before it. It is never narrower than a session's glyph, which stands in it. */
.nav-row-numeral {
  display: inline-grid;
  align-items: center;
  min-inline-size: 12px;
  color: var(--nav-row-aside-ink, var(--color-navigation-text-muted));
  font-variant-numeric: tabular-nums;

  > * {
    grid-area: 1/1;
  }
}

.nav-row-widest {
  visibility: hidden;
}

/* The second line: the state, how long and where the row belongs, smaller and muted, under
   the title and starting where it does, tucked up to it (`--nav-row-tuck`). */
.nav-row-detail {
  grid-column: 2;
  padding-block-end: calc(var(--nav-row-tuck));
  margin-block-start: calc(-1 * var(--nav-row-tuck));
  color: var(--nav-row-aside-ink, var(--color-navigation-text-muted));
  font-size: var(--font-size-meta);
}

/* The parent's title, the row's context: muted, and the first to give way. It shrinks six
   times as fast as the row's own title, down to a few letters of it that the hint completes
   (or all of a shorter one), and never takes more than two fifths of the words. Cut sideways
   only, like every word of the row (`.trimmed-word`). */
.nav-row-epic {
  --nav-row-epic-letters: 3ch;

  flex: 0 6 auto;
  min-width: min(3ch, var(--nav-row-epic-letters));
  max-width: 40%;
  color: var(--nav-row-aside-ink, var(--color-navigation-text-muted));
}

.nav-row-epic-mark {
  flex: none;
  color: var(--nav-row-aside-ink, var(--color-navigation-text-muted));
}

/* Short of room it ends in an ellipsis, cut sideways only (`.trimmed-word`). */
.nav-row-title {
  flex: 1 1 auto;
  color: var(--nav-row-title-ink, currentcolor);
}

/* A closed item's state is the space's own name and may be long: it never takes more than
   half the words, so the item's own title keeps the rest, and a longer name ends in an
   ellipsis that the row's hint completes rather than pushing the title out of the row and
   running under the pin. The standard closed states are shorter and stand whole. */
.nav-row-meta {
  display: inline-flex;
  flex: none;
  gap: var(--space-half);
  align-items: center;
  max-width: 50%;
  color: var(--nav-row-aside-ink, var(--color-navigation-text-muted));
  white-space: nowrap;

  > .trimmed-word {
    min-width: 0;
  }
}
</style>
