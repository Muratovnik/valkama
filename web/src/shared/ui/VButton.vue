<script setup lang="ts">
/**
 * The product's button, in the four weights it actually uses.
 *
 * Fifty-odd places styled their own before this existed, which is why the same
 * action could be a bordered control on one screen and bare text on the next.
 *
 * `primary` is the light-on-dark button of the Codex ground: the product has
 * one primary action per surface and it is achromatic, so the accent stays
 * free to mean selection and focus. `danger` is reserved for an action that
 * destroys something; a merely important action is `primary`.
 */
withDefaults(
  defineProps<{
    disabled?: boolean
    /** A square button holding one icon; its name comes from `aria-label`. */
    icon?: boolean
    /**
     * `compact` rides a dense header beside the compact controls, as
     * `SegmentedControl` and `ChoiceSelect` do. `inline` rides a line of content — a
     * checklist step, a link row — where a control-height button would make the line
     * two rows tall.
     */
    size?: 'default' | 'compact' | 'inline'
    title?: string
    type?: 'button' | 'submit'
    variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  }>(),
  {
    variant: 'secondary',
    type: 'button',
    disabled: false,
    title: undefined,
    size: 'default',
    icon: false,
  },
)
</script>

<template>
  <button
    class="button"
    :class="[`variant-${variant}`, `size-${size}`, { 'icon-only': icon }]"
    :type="type"
    :disabled="disabled"
    :title="title"
  >
    <slot />
  </button>
</template>

<style scoped>
/* A control is a fill on the surface ladder, not an outlined box: rest one
   step above its ground, hover one step further. The outline-and-thicken-on-
   hover treatment this replaces is the reviewed-out tell — an interface where
   every button is drawn instead of filled.

   A weight is a set of values, never a set of rules. Each variant below only
   declares what its fill and its label are at rest, hovered and disabled, and
   the one rule per state reads them. It used to be the other way round: the
   base hover rule painted every button the hover grey and outranked the
   primary's light fill, so a hovered primary went dark under its dark label —
   the look of a disabled button — and a disabled primary was the light fill at
   half strength, a grey slab. A state rule that declares no colour of its own
   has nothing to outrank a variant with. */
.button {
  --color-button-fill: var(--color-control-surface);
  --color-button-ink: var(--color-text);
  --color-button-fill-hover: var(--color-surface-active);
  --color-button-ink-hover: var(--color-button-ink);

  /* Unavailable is a look of its own rather than a faded copy of the weight:
     it recedes a step toward the ground and its label quietens, and it is the
     same for every weight, because a button that cannot be pressed has no
     emphasis left to rank. The label keeps 4.5:1 so it can still be read. */
  --color-button-fill-disabled: var(--color-control-disabled-surface);
  --color-button-ink-disabled: var(--color-text-tertiary);

  display: inline-flex;
  flex: 0 0 auto;
  gap: var(--space-2);
  justify-content: center;
  align-items: center;

  /* The row a button stands in. It named the 44px pointer target instead, which
     is why a button never matched the tab track beside it: the two numbers were
     the same token answering two different questions. */
  min-height: var(--size-control-height);
  padding: 0 var(--space-4);
  border: 0;
  color: var(--color-button-ink);
  font: var(--font-control);
  white-space: nowrap;
  background: var(--color-button-fill);
  border-radius: var(--radius-control);
  cursor: pointer;

  &:hover:not(:disabled) {
    color: var(--color-button-ink-hover);
    background: var(--color-button-fill-hover);
  }

  &:focus-visible {
    outline: 2px solid var(--color-focus-ring);
    outline-offset: 2px;
  }

  &:disabled {
    color: var(--color-button-ink-disabled);
    background: var(--color-button-fill-disabled);
    cursor: not-allowed;
  }

  /* The light fill, and on hover the same fill one step lighter still: stronger
     on a dark ground means further from it. */
  &.variant-primary {
    --color-button-fill: var(--color-action-primary);
    --color-button-ink: var(--color-text-on-action);
    --color-button-fill-hover: var(--color-action-primary-hover);

    font-weight: 600;
  }

  /* A ghost with a label rests on the control fill, so an action in a line of text
     reads as a control; an icon-only ghost has no label to read as one and stays bare,
     and bare when it is unavailable too. Either one's label brightens on hover. */
  &.variant-ghost {
    --color-button-ink: var(--color-text-muted);
    --color-button-ink-hover: var(--color-text);
  }

  &.variant-ghost.icon-only {
    --color-button-fill: transparent;
    --color-button-fill-hover: var(--color-surface-hover);
    --color-button-fill-disabled: transparent;
  }

  &.variant-danger {
    --color-button-ink: var(--color-action-danger);
  }

  &.size-compact {
    min-height: var(--size-control-height-compact);
    padding: 0 var(--space-3);
  }

  &.size-inline {
    gap: var(--space-1);
    min-height: var(--size-control-inline);
    padding: 0 var(--space-2);
    font-size: var(--font-size-dense);
  }

  /* Square at whichever height the size gives it, so an icon sits centred
     rather than on a label's padding. */
  &.icon-only {
    min-width: var(--size-control-height);
    padding: 0;
  }

  &.icon-only.size-compact {
    min-width: var(--size-control-height-compact);
  }

  &.icon-only.size-inline {
    min-width: var(--size-control-inline);
  }
}
</style>
