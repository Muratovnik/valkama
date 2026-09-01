<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import type {
  ImprovementSeverity,
  ImprovementState,
} from '@/entities/improvement/utils/improvementDerivations'

import SemanticState from '@/shared/ui/SemanticState.vue'

/**
 * A case state, as a chip beside its own heading or inline in a list.
 *
 * The badge keeps a ground where one state stands alone next to a title; a
 * list of cases takes `inline`, because a bordered chip repeated down every
 * row is a column of boxes rather than a column of states.
 */
withDefaults(
  defineProps<{
    state: ImprovementState
    severity?: ImprovementSeverity
    variant?: 'inline' | 'badge'
  }>(),
  { severity: undefined, variant: 'badge' },
)
const { t, te } = useI18n()
function stateText(state: ImprovementState): string {
  const key = `improvements.caseState.${state}`
  return te(key) ? t(key) : state
}
</script>
<template>
  <SemanticState
    dimension="case"
    :state="state"
    :label="stateText(state)"
    :variant="variant"
    :data-severity="severity"
  />
</template>
