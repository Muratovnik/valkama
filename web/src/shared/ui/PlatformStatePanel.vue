<script setup lang="ts" generic="T">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import type { PlatformUiState } from '@/shared/api/platformUiState.ts'
import { statePresentation } from '@/shared/lib/uiSystem.ts'
import DataEmptyState from '@/shared/ui/DataEmptyState.vue'
import VButton from '@/shared/ui/VButton.vue'
import VIcon from '@/shared/ui/VIcon.vue'

const props = withDefaults(
  defineProps<{
    state: PlatformUiState<T>
    compact?: boolean
    emptyDescription?: string
    retryable?: boolean
  }>(),
  {
    compact: false,
    retryable: true,
  },
)
const emit = defineEmits<{ retry: [] }>()
const { t, te } = useI18n()
const reason = computed(() => ('reason' in props.state ? (props.state.reason ?? '') : ''))
const reasonText = computed(() => (te(reason.value) ? t(reason.value) : reason.value))

/**
 * `ready` and `degraded` are one branch, because they render the same payload.
 *
 * They used to be two, each with its own `<slot>`, so every background refresh
 * switched branches and Vue rebuilt the module's entire subtree instead of
 * updating it. That was measurable, not theoretical: switching to the graph
 * remounted the Vue Flow canvas — a second transformation pane, a second
 * unfitted camera — and every screen threw its content away and rebuilt it
 * while the operator was reading it.
 */
const payload = computed<T | undefined>(() =>
  'payload' in props.state ? props.state.payload : undefined,
)

/**
 * A degraded state with no reason is a refresh in flight; with a reason it is a
 * refresh that failed. Only the second is news, and only news may take a line
 * of the layout. The first used to print "Refreshing…" into the flow, so the
 * whole screen jumped 26px down and back every few seconds on a live board;
 * it is now announced to assistive technology alone.
 */
const refreshInFlight = computed(() => props.state.status === 'degraded' && !reason.value)

/** A read that failed demands attention; every other state is a report. */
const panelRole = computed(() =>
  props.state.status === 'error' || props.state.status === 'permission-denied' ? 'alert' : 'status',
)

/** Absent rather than false, because `aria-busy="false"` is a claim and not a default. */
const busyMark = computed(() => props.state.status === 'loading' || undefined)

/** A refusal is understood rather than broken, so it is marked with a check and not a warning. */
const panelIcon = computed(() => (props.state.status === 'permission-denied' ? 'check' : 'info'))
</script>

<template>
  <template v-if="payload !== undefined">
    <aside
      v-if="state.status === 'degraded' && reason"
      class="platform-state-banner"
      role="status"
      :data-tone="statePresentation('platform-ui-state', state.status).tone"
    >
      <VIcon
        name="info"
        :size="18"
      />
      <span
        ><strong class="platform-state-banner-label">{{ t('platform.states.degraded') }}</strong
        >{{ reasonText }}</span
      >
    </aside>
    <span
      v-if="refreshInFlight"
      class="visually-hidden"
      role="status"
    >
      {{ t('platform.states.refreshing') }}
    </span>
    <slot :payload="payload" />
  </template>
  <!-- The empty status renders the same quiet object every ready-but-empty
       list renders, so the product has one voice for absence — and one
       message: the caller's reason when there is one, the generic line when
       there is not. This branch used to run through the band below, whose
       left-anchored icon and 68ch reason fell apart into three loose pieces
       across a wide table. -->
  <DataEmptyState
    v-else-if="state.status === 'empty'"
    :title="reasonText || t('platform.states.empty')"
    :description="emptyDescription"
    :compact="compact"
  >
    <template
      v-if="$slots.action"
      #action
      ><slot name="action"
    /></template>
  </DataEmptyState>
  <section
    v-else
    class="platform-state-panel"
    :class="{ compact }"
    :data-tone="statePresentation('platform-ui-state', state.status).tone"
    :role="panelRole"
    :aria-busy="busyMark"
  >
    <span
      v-if="state.status === 'loading'"
      class="work-dots"
      aria-hidden="true"
      ><i /><i /><i
    /></span>
    <VIcon
      v-else
      :name="panelIcon"
      :size="22"
    />
    <div class="platform-state-copy">
      <h2 class="platform-state-title">{{ t(`platform.states.${state.status}`) }}</h2>
      <p
        v-if="reason"
        class="platform-state-reason"
      >
        {{ reasonText }}
      </p>
    </div>
    <!-- The way out of the state belongs inside the panel that announces it.
         Three screens had a button sitting under the panel as an orphan, each
         with its own copy of the same declarations, and the panel's grid had a
         third column standing empty above it. -->
    <slot name="action">
      <VButton
        v-if="retryable && (state.status === 'error' || state.status === 'unavailable')"
        class="platform-state-retry"
        @click="emit('retry')"
      >
        {{ t('platform.actions.retry') }}
      </VButton>
    </slot>
  </section>
</template>

<style scoped>
.platform-state-panel {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: var(--space-4);
  align-content: center;
  align-items: center;
  min-height: 180px;
  padding: var(--space-6);
  color: var(--color-text);
  background: var(--color-surface);
  border-radius: var(--radius-card);

  &.compact {
    min-height: 96px;
    padding: var(--space-4);
  }
}

.platform-state-title {
  margin: 0;
  font-size: var(--font-size-section);
}

.platform-state-reason {
  max-width: 68ch;
  margin: var(--space-1) 0 0;
  color: var(--color-text-muted);
  font: var(--font-note);
}

/* A failure names itself the way the degraded banner does: a status edge on
   the panel's own ground, not a colored outline drawn around the whole box. */
.platform-state-panel[data-tone='danger'] {
  border-inline-start: 3px solid var(--color-danger);
}

.platform-state-banner {
  display: flex;
  gap: var(--space-3);
  align-items: flex-start;
  padding: var(--space-3) var(--space-4);
  color: var(--color-text);
  font-size: var(--font-size-dense);
  background: var(--color-surface-muted);
}

.platform-state-banner-label {
  display: block;
  margin-bottom: var(--space-half);
}

.platform-state-banner[data-tone='warning'] {
  border-inline-start: 3px solid var(--color-warning);
}

/* Unnamed on purpose: this panel appears in a module, in a drawer and in a
   dialog, so it asks whichever container it happens to be standing in rather
   than naming one of them and being wrong in the other two. */
@container (width <= 560px) {
  .platform-state-panel {
    grid-template-columns: auto minmax(0, 1fr);
  }

  .platform-state-retry {
    grid-column: 1/-1;
    width: 100%;
  }
}
</style>
