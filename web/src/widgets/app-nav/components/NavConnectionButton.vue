<script setup lang="ts">
/**
 * Whether the app is connected, and the button that asks it to catch up.
 *
 * One control, not a control beside a status line: the state is what a refresh is
 * about, so the dot, the word and the action are one target. The button is the
 * refresh action and says so by its icon and its tooltip; the word "Refresh"
 * printed under the state used to be a second line inside the control that does
 * it, and a centred dot beside a two-line block lines up with neither line.
 */
import { useI18n } from 'vue-i18n'

import { statePresentation } from '@/shared/lib/uiSystem.ts'
import VIcon from '@/shared/ui/VIcon.vue'

withDefaults(
  defineProps<{ connection?: 'connecting' | 'live' | 'reconnecting'; refreshing?: boolean }>(),
  { connection: 'connecting', refreshing: false },
)

const emit = defineEmits<{ refresh: [] }>()
const { t } = useI18n()
</script>

<template>
  <button
    type="button"
    class="nav-refresh"
    :class="{ refreshing }"
    :data-tone="statePresentation('connection-lifecycle', connection).tone"
    :disabled="refreshing"
    :title="t('refresh.title')"
    @click="emit('refresh')"
  >
    <span
      class="connection-dot"
      aria-hidden="true"
    />
    <span class="connection-copy">{{ t(`status.${connection}`) }}</span>
    <VIcon
      class="refresh-icon"
      name="refresh"
      :size="18"
      :stroke-width="1.7"
    />
  </button>
</template>

<style scoped>
.nav-refresh {
  display: grid;
  grid-template-columns: 8px minmax(0, 1fr) 20px;
  gap: var(--space-3);
  align-items: center;
  min-width: 0;
  min-height: var(--size-control-height);
  padding: 0 var(--space-3);
  border: 1px solid transparent;
  color: var(--color-text-on-dark-muted);
  text-align: left;
  background: transparent;
  border-radius: var(--radius-control);
  cursor: pointer;

  &:hover:not(:disabled) {
    color: var(--color-text-on-dark);
    background: var(--color-navigation-raised);
  }

  &:disabled {
    opacity: 0.72;
    cursor: wait;
  }
}

/* The size, the stroke, the fill and the colour are the icon's own props and
   Lucide's own defaults now. They were four declarations on a bare `svg` inside
   this control — a bet on what the icon library renders — and the size among them
   was overriding the size the template asked for, so the prop said 20 while the
   interface drew 18. What is left is the one thing no prop can say: this glyph
   turns while the refresh it belongs to is in flight. */
.nav-refresh.refreshing .refresh-icon {
  animation: refresh-spin 0.7s linear infinite;
}

/* One dot for the whole connection: the rail rations a status down to this, which
   is why it is a colour and not a word beside a word. The operational state is
   translated once by the shared presentation system; this component consumes
   only that canonical tone. */
.connection-dot {
  width: 8px;
  height: 8px;
  background: var(--color-text-tertiary);
  border-radius: 50%;

  .nav-refresh[data-tone='success'] & {
    background: var(--color-success);
  }

  .nav-refresh[data-tone='warning'] & {
    background: var(--color-warning);
  }
}

.connection-copy {
  min-width: 0;
  color: var(--color-text-on-dark);
  font: var(--font-label);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* The narrow rail keeps the dot and drops everything that needs a line: the word
   and the glyph beside it. The rail declares the `nav` container, so this control
   answers the question itself rather than being reached into by class name from
   the shell stylesheet. */
@container nav (width < 150px) {
  .nav-refresh {
    grid-template-columns: 1fr;
    justify-items: center;
    padding-inline: 0;
  }

  .connection-copy,
  .refresh-icon {
    display: none;
  }
}

@keyframes refresh-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
