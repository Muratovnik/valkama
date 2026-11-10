<script setup lang="ts">
import { computed } from 'vue'

import { semanticStatePresentation } from '@/shared/lib/uiSystem.ts'
import type { SemanticStatePair } from '@/shared/lib/uiSystem.ts'
import { vTooltip } from '@/shared/ui/tooltipAnchors.ts'

type Props = {
  label: string
  compact?: boolean
  /** It stands in a reference's preview, a hint's own content, which brings no hint of its own. */
  inPreview?: boolean
  variant?: 'inline' | 'badge' | 'dot'
} & SemanticStatePair

const props = withDefaults(defineProps<Props>(), {
  compact: false,
  inPreview: false,
  variant: 'inline',
})

/** The word said whole while it is cut; a dot's word is hidden for the reader, not cut. */
const cutLabel = computed(() =>
  props.variant === 'dot' || props.compact || props.inPreview ? '' : props.label,
)
</script>

<template>
  <span
    class="semantic-state"
    :class="[`variant-${variant}`, { compact }]"
    :data-dimension="dimension"
    :data-emphasis="semanticStatePresentation(props).emphasis"
    :data-state="state"
    :data-tone="semanticStatePresentation(props).tone"
  >
    <i
      class="state-dot"
      aria-hidden="true"
    />
    <span
      v-tooltip.clipped="cutLabel"
      class="state-label trimmed-word one-line"
      >{{ label }}</span
    >
  </span>
</template>

<style scoped>
.semantic-state {
  display: inline-flex;
  gap: var(--space-2);
  align-items: center;

  /* What holds it may be narrower than its word, and then the word is what gives way. */
  max-width: 100%;
  min-height: 24px;
  color: var(--color-text-muted);
  font: var(--font-field-label);
}

.state-dot {
  flex: 0 0 auto;
  width: 7px;
  height: 7px;
  border: 1px solid currentcolor;
  background: transparent;
  border-radius: 50%;
}

/* The word takes the tone with the dot, unless the host says otherwise through
   `--color-state-label`: on a ground lighter than the ladder's, a tone that reads
   as a dot is too dark for words, and the dot alone keeps saying it. Its box is trimmed to
   the letters (`.trimmed-word`), so the dot centres on their middle rather than on the em box,
   which stood about a pixel high. */
.state-label {
  min-width: 0;
  color: var(--color-state-label, currentcolor);
}

/* The badge variant keeps a ground so a state can sit in a dense column, but
   the ground is neutral: a row of colored pills reads as a row of alarms even
   when most of them say "waiting", which is the ordinary state of an agent. */
.semantic-state.variant-badge {
  min-height: 26px;
  padding: 0 var(--space-2);
  line-height: var(--line-height-flat);
  background: var(--color-surface);
  border-radius: 999px;
}

.semantic-state:is(.variant-dot, .compact) .state-label {
  position: absolute;
  width: 1px;
  height: 1px;
  white-space: nowrap;
  overflow: hidden;
  clip-path: inset(50%);
}

.semantic-state[data-tone='info'] {
  color: var(--color-info);
}

.semantic-state[data-tone='success'] {
  color: var(--color-success);
}

.semantic-state[data-tone='warning'] {
  color: var(--color-warning);
}

.semantic-state[data-tone='danger'] {
  color: var(--color-danger);
}

/* Filled for a state that has a tone, hollow for `neutral`, which is the
   ordinary state of an agent and gets no colour. The four are named rather than
   inverted with `:not([data-tone='neutral'])`: that selector matches every ancestor that
   is not the neutral root, so it would fill the dot even there. */
:is([data-tone='info'], [data-tone='success'], [data-tone='warning'], [data-tone='danger'])
  .state-dot {
  background: currentcolor;
}

/* `strong` marks a state that needs an operator, not a state that is merely
   coloured; it keeps its own tone rather than turning everything red. */
.semantic-state[data-emphasis='strong'] {
  font-weight: 700;
}
</style>
