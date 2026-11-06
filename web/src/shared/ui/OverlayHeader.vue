<script setup lang="ts">
/**
 * The head every overlay wears: what this is, what it is about, and the way
 * out. A dialog and an inspector are different surfaces, but their heads were
 * the same eight lines of markup and twenty of layout in two files, already
 * drifting — one drew a border around its close button and the other did not.
 */
import { computed, ref } from 'vue'

import VIcon from '@/shared/ui/VIcon.vue'

const props = withDefaults(
  defineProps<{
    title: string
    /** What the way out is called. A head with none is the head of a window, which has its own. */
    closeLabel?: string
    /** Which record the overlay is about: an identifier and its title. */
    context?: string
    /** The title can hold focus, for a host whose content takes it only once it arrives. */
    focusableTitle?: boolean
    /** What the title is in the page's outline: the top of it, on a page that is only this. */
    heading?: 'h1' | 'h2'
    /** A title that may run long stays on its line, and the whole of it is elsewhere. */
    singleLine?: boolean
    subtitle?: string
  }>(),
  {
    closeLabel: '',
    heading: 'h2',
    subtitle: '',
    context: '',
    focusableTitle: false,
    singleLine: false,
  },
)

const emit = defineEmits<{ close: [] }>()

const name = ref<HTMLElement | null>(null)
const nameFocus = computed(() => (props.focusableTitle ? -1 : undefined))
/** Absent where the title takes no focus, or F6 would be sent to something that cannot. */
const nameMark = computed(() => (props.focusableTitle ? '' : undefined))
defineExpose({ focusTitle: () => name.value?.focus({ preventScroll: true }) })
</script>

<template>
  <header
    class="overlay-header"
    :class="{ 'has-actions': $slots.actions }"
  >
    <div
      v-if="$slots.start"
      class="overlay-header-start"
    >
      <slot name="start" />
    </div>
    <div class="overlay-header-title">
      <component
        :is="heading"
        ref="name"
        class="overlay-header-name"
        :class="{ 'single-line': singleLine }"
        :tabindex="nameFocus"
        :data-pane-title="nameMark"
      >
        {{ title }}
      </component>
      <p
        v-if="subtitle"
        class="overlay-header-subtitle"
      >
        {{ subtitle }}
      </p>
      <span
        v-if="context"
        class="overlay-header-context"
        >{{ context }}</span
      >
      <slot name="meta" />
    </div>
    <div
      v-if="$slots.actions"
      class="overlay-header-actions"
    >
      <slot name="actions" />
    </div>
    <button
      v-if="closeLabel"
      class="overlay-header-close"
      type="button"
      :aria-label="closeLabel"
      @click="emit('close')"
    >
      <VIcon name="close" />
    </button>
  </header>
</template>

<style scoped>
/* `--overlay-header-reach` is how far a 44px control on the title's row stands out past the
   title's first line, above it and under it. */
.overlay-header {
  --overlay-header-reach: calc(
    (var(--size-control-target) - var(--font-size-module) * var(--line-height-snug)) / 2
  );

  display: flex;
  gap: var(--space-4);
  justify-content: space-between;
  align-items: flex-start;
  padding: var(--space-6);
  border-bottom: 1px solid var(--color-rule);
}

/* The controls on the title's row stand on its first line, and their hit areas reach into the
   head's inset instead of making the row taller. Laid out at their own height, the way out stood
   10px under the middle of a one-line title and left 21px more under the title than over it. */
.overlay-header-start,
.overlay-header-actions,
.overlay-header-close {
  margin-block: calc(-1 * var(--overlay-header-reach));
}

.overlay-header-start {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  min-height: var(--size-control-target);
}

.overlay-header-title {
  flex: 1 1 auto;
  min-width: 0;
}

/* An overlay title is the module step, the same one the context bar spends on
   the module name. Four overlays had four sizes for this — 19, 20, 20, 21 —
   which is the drift the ramp exists to stop. */
.overlay-header-name {
  margin: 0;
  font-size: var(--font-size-module);
  line-height: var(--line-height-snug);
  font-weight: 700;
  letter-spacing: -0.02em;
  overflow-wrap: anywhere;
  outline: none;

  &:focus-visible {
    outline: 2px solid var(--color-focus-ring);
    outline-offset: 2px;
  }

  &.single-line {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
}

.overlay-header-subtitle {
  max-width: 65ch;
  margin: var(--space-2) 0 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-interface);
  line-height: var(--line-height-normal);
}

/* What the overlay is about is read after the title, so it is set as the subtitle is: a
   step under it, in the note's weight. In the context bar's bold and flush with the title
   it read as a second title. */
.overlay-header-context {
  display: block;
  margin-top: var(--space-2);
  color: var(--color-text-muted);
  font: var(--font-note);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* As tall as the way out, so that the icons of the row stand on one line. They are one
   group, so they stand closer to each other than to the title and the way out: at the
   head's own gap four icons took 208 px of a 480 px pane and left the title 219. */
.overlay-header-actions {
  display: flex;
  flex: 0 0 auto;
  gap: var(--space-1);
  align-items: center;
  min-height: var(--size-control-target);
}

/* A head that would leave the title less than a line's worth gives that row to the title
   and what it is about: the actions take a row of their own under the way out. 560 px is
   where the document's own head and text step in too; beside four icons a pane of 480 px
   cut the title to its first two words and the path to its last letters. */
@container (width <= 560px) {
  .overlay-header.has-actions {
    flex-wrap: wrap;
    row-gap: var(--space-2);

    /* From nothing, so that a path longer than the row does not push the way out to a row
       of its own: the title takes what the first row leaves and gives up its words. */
    .overlay-header-title {
      flex-basis: 0;
    }

    /* A row of their own: nothing to stand on, so no reach into the row above. */
    .overlay-header-actions {
      flex-basis: 100%;
      justify-content: flex-end;
      order: 1;
      margin-block: 0;
    }
  }
}

/* The head already draws the rule under itself; a second outline around the
   close button inside it is the ration DESIGN.md spends elsewhere. */
.overlay-header-close {
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  width: var(--size-control-target);
  height: var(--size-control-target);
  padding: 0;
  border: 1px solid transparent;
  color: var(--color-text-muted);
  background: transparent;
  border-radius: var(--radius-control);
  cursor: pointer;

  &:hover {
    color: var(--color-text);
    border-color: var(--color-rule);
  }
}
</style>
