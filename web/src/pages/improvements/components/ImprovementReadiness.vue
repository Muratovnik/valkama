<script setup lang="ts">
/**
 * Whether the analyzer can say anything useful yet, and why not.
 *
 * Four states, and each one names the missing piece rather than the fact of being
 * unready: the profile is off, there is no evidence to read, the analysis ran and
 * found nothing, or it is ready. Beside them stand the two figures the answer is
 * derived from, so the operator can see what "no evidence" is counting.
 */
import { useI18n } from 'vue-i18n'

import type {
  ImprovementActivationStatus,
  ImprovementSignalSummary,
} from '@/entities/improvement/utils/improvementDerivations'
import { IMPROVEMENT_EVIDENCE_SOURCES } from '@/entities/improvement/utils/improvementDerivations'

import SectionHeading from '@/shared/ui/SectionHeading.vue'
import SemanticState from '@/shared/ui/SemanticState.vue'

const { activation } = defineProps<{
  activation: { status: ImprovementActivationStatus }
  signalSummary: ImprovementSignalSummary | null
}>()
const { t } = useI18n()

/** The sentence for this state, named by what is missing from it. */
const NOTE_KEY: Partial<Record<ImprovementActivationStatus, string>> = {
  disabled: 'improvements.activationDisabled',
  needs_evidence: 'improvements.activationEvidence',
  analyzed_empty: 'improvements.activationEmpty',
}
</script>

<template>
  <section
    class="readiness-panel"
    :aria-label="t('improvements.readiness')"
  >
    <div class="readiness-copy">
      <div class="readiness-heading">
        <SectionHeading>{{ t('improvements.readiness') }}</SectionHeading>
        <SemanticState
          dimension="improvement-readiness"
          :state="activation.status"
          :label="t(`improvements.activationState.${activation.status}`)"
        />
      </div>
      <p class="readiness-note">
        {{ t(NOTE_KEY[activation.status] ?? 'improvements.activationReady') }}
      </p>
      <p class="readiness-sources">
        <strong class="sources-label">{{ t('improvements.availableSources') }}</strong>
        <span
          v-for="source in IMPROVEMENT_EVIDENCE_SOURCES"
          :key="source.kind"
          class="source-name"
          >{{ t(source.labelKey) }}</span
        >
      </p>
    </div>
    <dl
      v-if="signalSummary"
      class="signal-figures"
    >
      <div class="signal-figure">
        <dt class="figure-label">{{ t('improvements.signalCount') }}</dt>
        <dd class="figure-value">{{ signalSummary.total }}</dd>
      </div>
      <div class="signal-figure">
        <dt class="figure-label">{{ t('improvements.sessionCount') }}</dt>
        <dd class="figure-value">{{ signalSummary.session_count }}</dd>
      </div>
    </dl>
  </section>
</template>

<style scoped>
.readiness-panel {
  display: grid;
  gap: var(--space-5);
  padding: var(--space-4);
  margin-top: var(--space-3);
  background: var(--color-surface);
  border-radius: var(--radius-card);
}

.readiness-copy {
  min-width: 0;
}

.readiness-heading {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  align-items: center;
}

.readiness-note {
  max-width: 72ch;
  margin-top: var(--space-2);
  color: var(--color-text-muted);
  font: var(--font-note);
}

.readiness-sources {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1) var(--space-2);
  align-items: baseline;
  margin-top: var(--space-3);
  color: var(--color-text-muted);
  font-size: var(--font-size-dense);
}

.sources-label {
  color: var(--color-text);
}

/* The dot between two source names belongs to the seam, not to either name. It
   used to be written into the loop as a string the first pass left empty, which
   put "is this the first item" in the template and hung the glyph off the front
   of the word after it, off-centre inside the gap this list already spends. */
.source-name + .source-name::before {
  content: '·';
  margin-inline-end: var(--space-2);
}

.signal-figures {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-1);
}

.signal-figure {
  display: grid;
  gap: var(--space-1);
  min-width: 112px;
  padding: var(--space-3) var(--space-4);
  background: var(--color-surface-muted);
  border-radius: var(--radius-status);
}

.figure-label {
  color: var(--color-text-muted);
  font-size: var(--font-size-dense);
}

.figure-value {
  font: var(--font-section-title);
  font-variant-numeric: tabular-nums;
}

/* Wide enough for the figures to stand beside the copy rather than under it. */
@container workspace (width >= 764px) {
  .readiness-panel {
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
  }
}
</style>
