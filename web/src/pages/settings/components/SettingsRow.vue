<script setup lang="ts">
/** A setting as the screen reads it: what it is on the left, its control on the right. */
import FieldError from '@/shared/ui/FieldError.vue'

defineProps<{
  label: string
  /** Why the last change to this row did not hold; it stands under the control. */
  failure?: string
  hint?: string
  /** For a control that takes its description from this row's hint. */
  hintId?: string
  /** For a control that takes its name from this row's label. */
  labelId?: string
  /**
   * The control column is a stack of several things, as a caption over each of two
   * places or a list of checkboxes: the name stands at its top, on the line of the first.
   */
  stack?: boolean
  /**
   * The control is a row of choices that may be wider than half the row: it starts half way
   * and reaches toward the name as far as its words need, down to the name's floor, and past
   * that stands under the name.
   */
  wide?: boolean
}>()
</script>

<template>
  <div
    class="settings-row"
    :class="{ stack, wide }"
  >
    <span class="settings-row-identity">
      <strong
        :id="labelId"
        class="settings-row-label"
        ><slot name="label">{{ label }}</slot></strong
      >
      <small
        v-if="hint"
        :id="hintId"
        class="settings-row-hint"
        >{{ hint }}</small
      >
    </span>
    <div class="settings-row-control">
      <slot />
      <FieldError
        v-if="failure"
        role="alert"
        >{{ failure }}</FieldError
      >
    </div>
  </div>
</template>

<style scoped>
.settings-row {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--size-column-gutter);
  align-items: center;
  min-width: 0;
  padding: var(--space-3) var(--space-4);
  border-bottom: 1px solid var(--color-rule);

  /* Centred, a name hung half way down a stack, beside nothing it names. On the first
     baseline it stands on the line of the stack's first words, wherever they start in it:
     a caption at the very top, a checkbox's words under the padding of its line. A single
     control stays centred, because a select drawn with a glyph first gives the glyph's foot
     as its baseline, and the name would sink by it. */
  &.stack {
    align-items: baseline;
  }

  /* The choice starts where every row's does, half way, and reaches further toward the name
     as far as its words need while the name keeps 12rem; where it does not fit even so, it
     stands under the name, as a narrow row's does. Held to half the row, Participation's set
     of four segments wrapped its last onto a second line at 1280px, 445 by 78 beside a scope
     choice 40 tall, while the name beside it had more room than it used. A grid could only
     wrap the choice inside its column there, three segments over one. */
  &.wide {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3) var(--size-column-gutter);

    .settings-row-identity {
      flex: 1 1 12rem;
    }

    .settings-row-control {
      flex: 0 0 calc(50% - var(--size-column-gutter) / 2);
      min-width: fit-content;
    }
  }
}

.settings-row-identity {
  display: grid;
  gap: var(--space-label-value);
  min-width: 0;

  .settings-row-label {
    font: var(--font-label);
  }

  .settings-row-hint {
    color: var(--color-text-muted);
    font: var(--font-detail);
  }
}

.settings-row-control {
  display: grid;
  gap: var(--space-2);
  min-width: 0;
}

/* A narrow workspace stands every row's control under its name, a wide row's as well: beside it
   at 760px the launch place stood alone on the page next to its name. */
@container workspace (width <= 696px) {
  .settings-row,
  .settings-row.wide {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--space-3);
    align-items: start;
  }
}
</style>
