<script setup lang="ts">
/**
 * A write the server refused: what was refused, why, and what to do about it.
 *
 * The reason is the server's own sentence, because it is the one that knows
 * which step is open or who holds the claim. Each guard it names gets a line in
 * the reader's language and, where the inspector can do the next thing itself,
 * the button that does it. Carrying the move through anyway is offered only when
 * the server accepts an override, and only after a second, explicit answer.
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import type { RefusalNotice } from '@/widgets/work-item-inspector/utils/useInspectorWrites.ts'

import ConfirmStrip from '@/shared/ui/ConfirmStrip.vue'
import VButton from '@/shared/ui/VButton.vue'

const props = defineProps<{ busy: boolean; notice: RefusalNotice }>()
const emit = defineEmits<{ dismiss: []; force: []; guard: [name: string] }>()
const { t, te } = useI18n()
const confirming = ref(false)

/** The guards this inspector can explain, each with the action it can take for it. */
const steps = computed(() =>
  (props.notice.guards ?? [])
    .filter((guard) => te(`workItem.refusal.guard.${guard}`))
    .map((guard) => ({
      guard,
      hint: t(`workItem.refusal.guard.${guard}`),
      action: te(`workItem.refusal.action.${guard}`) ? t(`workItem.refusal.action.${guard}`) : '',
    })),
)

function force() {
  confirming.value = false
  emit('force')
}
</script>

<template>
  <div
    class="refusal"
    role="alert"
  >
    <div class="refusal-head">
      <strong class="refusal-title">{{ notice.title }}</strong>
      <VButton
        variant="ghost"
        size="inline"
        @click="emit('dismiss')"
        >{{ t('workItem.refusal.dismiss') }}</VButton
      >
    </div>
    <ul
      v-if="steps.length"
      class="refusal-steps"
    >
      <li
        v-for="step in steps"
        :key="step.guard"
        class="refusal-step"
      >
        <span>{{ step.hint }}</span>
        <VButton
          v-if="step.action"
          size="inline"
          :disabled="busy"
          @click="emit('guard', step.guard)"
          >{{ step.action }}</VButton
        >
      </li>
    </ul>
    <p class="refusal-reason">{{ t('workItem.refusal.reason', { reason: notice.reason }) }}</p>
    <template v-if="notice.force">
      <!-- Hidden rather than removed while asked, so the answer can hand focus
           back to it. -->
      <VButton
        v-show="!confirming"
        class="refusal-force"
        size="inline"
        :disabled="busy"
        @click="confirming = true"
        >{{ notice.force.label }}</VButton
      >
      <ConfirmStrip
        v-if="confirming"
        tone="danger"
        :message="notice.force.question"
        :confirm-label="notice.force.label"
        :cancel-label="t('workItem.cancel')"
        @confirm="force"
        @cancel="confirming = false"
      />
    </template>
  </div>
</template>

<style scoped>
/* A refusal is news about the item, so it stands on the sheet tone in the head
   rather than as red text at the top of a body the reader may have scrolled
   away from. */
.refusal {
  display: grid;
  gap: var(--space-2);
  padding: var(--space-3);
  background: var(--color-surface-muted);
  border-radius: var(--radius-card);
}

.refusal-head {
  display: flex;
  gap: var(--space-2);
  justify-content: space-between;
  align-items: center;
}

.refusal-title {
  color: var(--color-danger);
  font: var(--font-strong);
}

.refusal-steps {
  display: grid;
  gap: var(--space-1);
  padding: 0;
  margin: 0;
  list-style: none;
}

.refusal-step {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1) var(--space-2);
  align-items: center;
  color: var(--color-text);
  font: var(--font-note);
}

.refusal-reason {
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-detail);
  overflow-wrap: anywhere;
}

/* Filled like the guard actions above it, so its edge is the text column's edge;
   a bare ghost label sat a padding's width inside it and read as loose. */
.refusal-force {
  justify-self: start;
}
</style>
