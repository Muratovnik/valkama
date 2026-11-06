<script setup lang="ts">
/**
 * What a form still held when its question closed some other way, or its task did: the only
 * copy of what was written, under its own words. A choice made there was never sent either, so
 * it is said too, one line per field, ahead of the words; a form that held only a choice used
 * to fold as if it had held nothing.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  /** What was still being written. */
  unsent: string
  /** What was chosen and not sent, a line per field. */
  unsentChosen: readonly string[]
}>()
const { t } = useI18n()
/** What the note over the unsent part says it is: what was chosen, written, or both. */
const unsentNote = computed(() => {
  if (!props.unsentChosen.length) return t('requests.draftKept')
  return t(props.unsent ? 'requests.draftKeptBoth' : 'requests.draftKeptChosen')
})
</script>

<template>
  <div
    v-if="unsent || unsentChosen.length"
    class="request-unsent"
  >
    <p class="request-unsent-note">{{ unsentNote }}</p>
    <p
      v-for="line in unsentChosen"
      :key="line"
      class="request-unsent-text"
    >
      {{ line }}
    </p>
    <p
      v-if="unsent"
      class="request-unsent-text"
    >
      {{ unsent }}
    </p>
  </div>
</template>

<style scoped>
.request-unsent {
  display: grid;
  gap: var(--space-1);
  min-width: 0;
}

.request-unsent-note {
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-detail);
}

.request-unsent-text {
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-editor);
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}
</style>
