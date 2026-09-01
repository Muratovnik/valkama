<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import type { ImprovementEvidence } from '@/entities/improvement/utils/improvementDerivations'
import { evidenceExcerpt } from '@/entities/improvement/utils/improvementDerivations'
defineProps<{ evidence: ImprovementEvidence[] }>()
const { t, d } = useI18n()
/** Enough of a hash to recognise, not enough to read as an id. */
function shortHash(value: string): string {
  return value.slice(0, 10)
}

function timestamp(value: string): string {
  const parsed = new Date(value)
  return Number.isNaN(parsed.valueOf()) ? value : d(parsed, 'activity')
}
</script>
<template>
  <section
    class="evidence"
    :aria-label="t('improvements.evidence')"
  >
    <h3>
      {{ t('improvements.evidence') }} <span>{{ evidence.length }}</span>
    </h3>
    <p
      v-if="!evidence.length"
      class="muted"
    >
      {{ t('improvements.noEvidence') }}
    </p>
    <article
      v-for="item in evidence"
      :key="item.id"
      class="evidence-row"
    >
      <header>
        <code>{{ item.pointer }}</code
        ><time :datetime="item.at">{{ timestamp(item.at) }}</time>
      </header>
      <p>{{ evidenceExcerpt(item) }}</p>
      <footer>
        <span>{{ item.client }} · {{ t(`improvements.severity.${item.severity}`) }}</span
        ><span :title="item.source_hash"
          >{{ t('improvements.sourceHash') }} · {{ shortHash(item.source_hash) }}</span
        >
      </footer>
    </article>
  </section>
</template>
<style scoped>
.evidence {
  display: grid;
  gap: var(--space-3);

  h3 {
    display: flex;
    gap: var(--space-2);
    margin: 0;
    font-size: var(--font-size-emphasis);

    & span {
      color: var(--color-action-primary);
      font-size: var(--font-size-dense);
    }
  }
}

.evidence-row {
  padding: var(--space-4);
  background: var(--color-control-surface);
  border-radius: var(--radius-control);

  code {
    color: var(--color-action-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  p {
    margin: var(--space-3) 0;
    color: var(--color-text);
    font: var(--font-paragraph-dense);
    overflow-wrap: anywhere;
    white-space: pre-wrap;
  }

  header,
  footer {
    display: flex;
    gap: var(--space-3);
    justify-content: space-between;
    color: var(--color-text-muted);
    font-size: var(--font-size-dense);
  }
}

.muted {
  color: var(--color-text-muted);
  font-size: var(--font-size-dense);
}
</style>
