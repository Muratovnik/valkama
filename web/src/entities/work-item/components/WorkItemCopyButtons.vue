<script setup lang="ts">
/**
 * A work item's number, which copies itself, and the link icon beside it, which copies the
 * item's address: the same two controls wherever a number stands as the item's own, a card's
 * head and the card a reference shows. What they did is the host's to say (`IdentityNote`).
 */
import { useI18n } from 'vue-i18n'

import { vTooltip } from '@/shared/ui/tooltipAnchors.ts'
import VIcon from '@/shared/ui/VIcon.vue'

defineProps<{
  reference: string
  copyLink: () => void
  copyReference: () => void
}>()

const { t } = useI18n()
</script>

<template>
  <button
    v-tooltip.detail="t('workItem.head.copyReferenceHint')"
    class="head-reference"
    type="button"
    :aria-label="t('workItem.head.copyReference', { reference })"
    @click="copyReference"
  >
    {{ reference }}
  </button>
  <button
    v-tooltip.name="t('workItem.head.copyLink', { reference })"
    class="identity-link"
    type="button"
    :aria-label="t('workItem.head.copyLink', { reference })"
    @click="copyLink"
  >
    <VIcon
      name="link"
      :size="14"
    />
  </button>
</template>

<style scoped>
.head-reference,
.identity-link {
  display: inline-flex;
  align-items: center;
  min-block-size: var(--size-control-inline);
  padding: 0;
  border: 0;
  color: inherit;
  font: inherit;
  background: none;
  border-radius: var(--radius-status);
  cursor: pointer;

  &:hover {
    color: var(--color-text);
  }

  &:focus-visible {
    outline: var(--size-focus-ring) solid var(--color-focus-ring);
    outline-offset: 2px;
  }
}

.head-reference {
  font-family: var(--font-family-mono);
  font-variant-numeric: tabular-nums;
}

/* The link belongs to the reference it copies, a step apart so the two rings never touch. */
.identity-link {
  flex: none;
  justify-content: center;
  min-inline-size: var(--size-control-inline);
  margin-inline-start: var(--space-1);
}
</style>
