<script setup lang="ts">
/**
 * The four facts an operator reads before deciding anything, and the identifiers
 * behind a disclosure.
 *
 * The split is by who asks. Four cards answer "what is this session doing and how
 * would I reach it"; the session id, exact Planning space and working directory answer
 * "which process exactly", which is a question asked once, when something is
 * wrong. A `<details>` is what keeps the second from crowding the first.
 */
import { storeToRefs } from 'pinia'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { sessionIdentity, stepSummary } from '@/entities/session/sessionDerivations.ts'

import { planningSpaceRef } from '@/shared/api/platformPlanningRefs.ts'
import { openerFor } from '@/shared/lib/settings'
import { useSettingsStore } from '@/shared/stores/settingsStore'
import type { AgentSession } from '@/shared/types/session.ts'

const { session } = defineProps<{ session: AgentSession }>()
const { t, d } = useI18n()
const { settings } = storeToRefs(useSettingsStore())

const identity = computed(() => sessionIdentity(session))
const selectedOpener = computed(() =>
  openerFor(session.client_family ?? session.client, settings.value),
)
const planningSpaceKey = computed(() => {
  const resourceRef = session.space_root?.resource_ref
  if (!resourceRef) return ''
  try {
    return planningSpaceRef(resourceRef)?.space_key ?? ''
  } catch {
    return ''
  }
})

/**
 * The full path in a tooltip, and no tooltip at all when there is no path.
 *
 * The line itself says "no scope" in that case, and a tooltip repeating the
 * absence would be a hover that reports nothing.
 */
const scopeTitle = computed(() => session.cwd || undefined)

function formatTime(value: string): string {
  const parsed = new Date(value)
  return Number.isNaN(parsed.valueOf()) ? value : d(parsed, 'activity')
}
</script>

<template>
  <section class="session-overview">
    <div class="overview-fact">
      <span class="fact-label">{{ t('monitor.lastActivity') }}</span
      ><strong class="fact-value">{{ formatTime(session.last_seen) }}</strong>
    </div>
    <div class="overview-fact">
      <span class="fact-label">{{ t('monitor.currentStep') }}</span
      ><strong class="fact-value">{{ stepSummary(session) || t('monitor.noCurrentStep') }}</strong>
    </div>
    <div class="overview-fact">
      <span class="fact-label">{{ t('monitor.openWith') }}</span
      ><strong class="fact-value">{{
        t(`settings.opener.${selectedOpener?.kind ?? 'custom'}`)
      }}</strong>
    </div>
    <div class="overview-fact">
      <span class="fact-label">{{ t('monitor.adapter') }}</span
      ><strong class="fact-value">{{ identity?.adapterId }}</strong>
    </div>
  </section>

  <details class="technical-detail">
    <summary class="technical-summary">{{ t('monitor.technical') }}</summary>
    <p class="session-identity">
      <span class="session-id">{{ session.id }}</span>
      <span
        v-if="planningSpaceKey"
        class="session-space"
        >{{ planningSpaceKey }}</span
      >
      <span
        class="session-cwd"
        :title="scopeTitle"
        >{{ session.cwd || t('monitor.noScope') }}</span
      >
    </p>
  </details>
</template>

<style scoped>
.session-overview {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-2);
  margin: var(--space-2) 0 var(--space-5);
}

.overview-fact {
  display: grid;
  gap: var(--space-1);
  padding: var(--space-3);
  background: color-mix(in srgb, var(--color-surface-recess) 62%, transparent);
  border-radius: var(--radius-card);
}

.fact-label {
  color: var(--color-text-muted);
  font: var(--font-line);
}

.fact-value {
  color: var(--color-text);
  font: var(--font-size-interface)/var(--line-height-snug) var(--font-family-interface);
  overflow-wrap: anywhere;
}

.technical-detail {
  margin: 0 0 var(--space-5);

  &[open] .technical-summary {
    margin-bottom: var(--space-2);
  }
}

.technical-summary {
  width: fit-content;
  color: var(--color-text-muted);
  font: var(--font-label);
  cursor: pointer;
}

.session-identity {
  display: grid;
  gap: var(--space-1);
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-note);
}

.session-id {
  overflow-wrap: anywhere;
  user-select: all;
}

.session-cwd {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.session-space {
  color: var(--color-text);
}

/* The container is the overlay the drawer sits in, which is narrower than the
   window by however much the operator has dragged it. */
@container overlay (width <= 600px) {
  .session-overview {
    grid-template-columns: 1fr;
  }
}
</style>
