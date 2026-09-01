<script setup lang="ts">
import { semanticStatePresentation } from '@/shared/lib/uiSystem.ts'
import type { SemanticStatePair } from '@/shared/lib/uiSystem.ts'

type Props = {
  label: string
  compact?: boolean
  variant?: 'inline' | 'badge' | 'dot'
} & SemanticStatePair

const props = withDefaults(defineProps<Props>(), { compact: false, variant: 'inline' })
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
    <span class="state-label">{{ label }}</span>
  </span>
</template>

<style scoped>
.semantic-state {
  display: inline-flex;
  gap: var(--space-2);
  align-items: center;
  min-height: 24px;
  color: var(--color-text-muted);
  font: var(--font-field-label);
  white-space: nowrap;
}

.state-dot {
  flex: 0 0 auto;
  width: 7px;
  height: 7px;
  border: 1px solid currentcolor;
  background: transparent;
  border-radius: 50%;
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
