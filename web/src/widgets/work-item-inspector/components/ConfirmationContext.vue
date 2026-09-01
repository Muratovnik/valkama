<script setup lang="ts">
/**
 * What an adapter write is about to touch, stated before it is confirmed.
 *
 * Attach, open and detach each asked the same three questions — which project,
 * which work item, which resource — in three copies of the same list. A copy here
 * is a chance for one of the three confirmations to stop naming the item.
 */
import { useI18n } from 'vue-i18n'

defineProps<{ projectId: string; target: string; workItem: string }>()
const { t } = useI18n()
</script>

<template>
  <dl class="confirmation-context">
    <div class="context-fact">
      <dt class="context-term">{{ t('platform.relations.projectScope') }}</dt>
      <dd class="context-value">{{ projectId }}</dd>
    </div>
    <div class="context-fact">
      <dt class="context-term">{{ t('platform.relations.workItemIdentity') }}</dt>
      <dd class="context-value">{{ workItem }}</dd>
    </div>
    <div class="context-fact">
      <dt class="context-term">{{ t('platform.relations.resourceTarget') }}</dt>
      <dd class="context-value">{{ target }}</dd>
    </div>
  </dl>
</template>

<style scoped>
.confirmation-context {
  display: grid;
  gap: var(--space-1);
  margin: 0;

  .context-fact {
    display: grid;
    grid-template-columns: minmax(110px, 0.35fr) minmax(0, 1fr);
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
    background: var(--color-surface-muted);
    border-radius: var(--radius-status);
  }

  .context-term {
    color: var(--color-text-muted);
    font-size: var(--font-size-dense);
  }

  /* Identifiers a person compares character by character, so the metadata font. */
  .context-value {
    margin: 0;
    font: var(--font-code);
    overflow-wrap: anywhere;
  }
}
</style>
