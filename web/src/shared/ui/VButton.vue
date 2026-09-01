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
    title?: string
    type?: 'button' | 'submit'
    variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  }>(),
  { variant: 'secondary', type: 'button', disabled: false, title: undefined },
)
</script>

<template>
  <button
    class="button"
    :class="`variant-${variant}`"
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
   every button is drawn instead of filled. */
.button {
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
  color: var(--color-text);
  font: var(--font-control);
  white-space: nowrap;
  background: var(--color-control-surface);
  border-radius: var(--radius-control);
  cursor: pointer;

  &:hover:not(:disabled) {
    background: var(--color-surface-active);
  }

  &:focus-visible {
    outline: 2px solid var(--color-focus-ring);
    outline-offset: 2px;
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  &.variant-primary {
    color: var(--color-text-on-action);
    font-weight: 600;
    background: var(--color-action-primary);
  }

  &.variant-primary:hover:not(:disabled) {
    opacity: 0.9;
  }

  &.variant-ghost {
    color: var(--color-text-muted);
    background: transparent;
  }

  &.variant-ghost:hover:not(:disabled) {
    color: var(--color-text);
    background: var(--color-surface-hover);
  }

  &.variant-danger {
    color: var(--color-action-danger);
  }
}
</style>
