<script setup lang="ts">
/**
 * The product's button, in the five weights it actually uses.
 *
 * Fifty-odd places styled their own before this existed, which is why the same
 * action could be a bordered control on one screen and bare text on the next.
 *
 * `primary` is the light-on-dark button of the Codex ground: the product has
 * one primary action per surface and it is achromatic, so the accent stays
 * free to mean selection and focus. `danger` is reserved for an action that
 * destroys something; a merely important action is `primary`. `text` is an offer
 * that repeats down a surface, such as the rest of a group, where a fill per row
 * would be louder than the rows.
 */
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    disabled?: boolean
    /** A square button holding one icon; its name comes from `aria-label`. */
    icon?: boolean
    /**
     * The target an icon button has, for a button a narrow host shows as its sign alone,
     * hiding its words: under a finger or on a phone-wide screen it answers a press across
     * `--size-control-target` whatever it draws.
     */
    reach?: boolean
    /**
     * `compact` rides a dense header beside the compact controls, as
     * `SegmentedControl` and `ChoiceSelect` do. `inline` rides a line of content — a
     * checklist step, a link row — where a control-height button would make the line
     * two rows tall.
     */
    size?: 'default' | 'compact' | 'inline'
    title?: string
    type?: 'button' | 'submit'
    variant?: 'primary' | 'secondary' | 'ghost' | 'text' | 'danger'
  }>(),
  {
    variant: 'secondary',
    type: 'button',
    disabled: false,
    title: undefined,
    size: 'default',
    icon: false,
    reach: false,
  },
)

/** An icon button reaches as one given `reach` does, but for an inline one (`EntryHead`). */
const reaching = computed(() => props.reach || (props.icon && props.size !== 'inline'))
</script>

<template>
  <button
    class="button reach-box"
    :class="[`variant-${variant}`, `size-${size}`, { 'icon-only': icon, 'reach': reaching }]"
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

  /* A forced palette clears the fill that made this a control, which leaves its words
     reading as text. The outline takes no room, and the focus ring below replaces it. */
  @media (forced-colors: active) {
    outline: 1px solid ButtonText;
    outline-offset: -1px;
  }

  &:hover:not(:disabled, [aria-disabled='true']) {
    color: var(--color-button-ink-hover);
    background: var(--color-button-fill-hover);
  }

  &:focus-visible {
    outline: var(--size-focus-ring) solid var(--color-focus-ring);
    outline-offset: 2px;
  }

  /* `aria-disabled` is a control that keeps focus through what it waits for. */
  &:is(:disabled, [aria-disabled='true']) {
    color: var(--color-button-ink-disabled);
    background: var(--color-button-fill-disabled);
    cursor: not-allowed;

    /* A forced palette paints a disabled button as an enabled one, since the ink and the
       fill that told them apart are both cleared; its colour for unavailable text does. */
    @media (forced-colors: active) {
      color: GrayText;
      outline-color: GrayText;
    }
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

  /* Bare at rest and a fill only under the pointer: a ghost's fill on every cell
     of a board stood level with the tiles it offered. */
  &.variant-text {
    --color-button-fill: transparent;
    --color-button-ink: var(--color-text-muted);
    --color-button-ink-hover: var(--color-text);
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
    padding: 0 var(--space-fill-inset);
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

/* An icon has no words to widen its box, so where a finger presses its target reaches past
   what it draws (`reach.css`), and every button is the box of a reach there, at the weight of
   the base rule, so a host that places it keeps its own position. An inline icon grows its own
   box instead where its host asks (`reach-grow`), because a line of them two pixels apart has
   no room around each to reach into. */
</style>

<style scoped src="./reach.css"></style>
