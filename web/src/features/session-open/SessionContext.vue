<script setup lang="ts">
/**
 * A session a text or an address named, as the server knows it: which client, in what
 * state, in which folder, a way to link it to an item when it has none, and the same
 * button that opens a session everywhere else. Every line is the dictionary's: the
 * server's `detail` is English for its own log, and an error's text is not for the page.
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import OpenAction from '@/features/session-open/OpenAction.vue'

import { attachSession } from '@/shared/api/executionApi.ts'
import { WORK_ITEM_REFERENCE } from '@/shared/api/planningModel.ts'
import { sessionFamilyOf } from '@/shared/lib/settings.ts'
import type { ResolvedRef } from '@/shared/types/reference.ts'
import DialogFrame from '@/shared/ui/DialogFrame.vue'
import VButton from '@/shared/ui/VButton.vue'
import VTextInput from '@/shared/ui/VTextInput.vue'

const props = defineProps<{ context: ResolvedRef }>()
const emit = defineEmits<{ close: [] }>()
const { t } = useI18n()
const failure = ref('')
const busy = ref(false)
const reference = ref('')
const canonicalReference = computed(() => reference.value.trim().toUpperCase())
const attachable = computed(() => WORK_ITEM_REFERENCE.test(canonicalReference.value) && !busy.value)

const STATE_WORDS = new Set(['active', 'ended', 'failed'])

/** The session as the record has it, or why no one session answers to this id. */
const description = computed(() => {
  const { client, cwd, resolved, session, status = '' } = props.context
  if (!resolved) {
    if (status !== 'ambiguous') return t('open.context.missing')
    return t(session ? 'open.context.spaces' : 'open.context.several')
  }
  const state = STATE_WORDS.has(status) ? t(`open.context.${status}`) : ''
  return [client, state, cwd || t('open.context.noFolder')].filter(Boolean).join(' · ')
})

async function attach() {
  if (!attachable.value) return
  busy.value = true
  failure.value = ''
  try {
    await attachSession(canonicalReference.value, props.context.session ?? props.context.value)
    emit('close')
  } catch (error) {
    failure.value = t('open.context.attachFailed')
    console.error(error)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <DialogFrame
    :open="true"
    :title="t('reference.session')"
    :context="context.value"
    :close-label="t('drawer.close')"
    :busy="busy"
    :error="failure"
    @close="emit('close')"
    @submit="attach"
  >
    <div class="session-context">
      <p class="session-context-line">{{ description }}</p>
      <div
        v-if="context.resolved && !context.work_item"
        class="session-context-attach"
      >
        <VTextInput
          v-model="reference"
          :label="t('workItem.linkOther')"
          :maxlength="20"
        />
        <VButton
          type="submit"
          :disabled="!attachable"
          >{{ t('platform.actions.relation.attach') }}</VButton
        >
      </div>
    </div>
    <template #footer>
      <OpenAction
        v-if="context.resolved"
        size="default"
        variant="primary"
        :session="context.session ?? context.value"
        :family="context.client_family ?? sessionFamilyOf(context.client ?? '')"
        :action="t('session.open')"
      />
    </template>
  </DialogFrame>
</template>

<style scoped>
.session-context {
  display: grid;
  gap: var(--space-heading-content);
}

.session-context-line {
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-note);
  overflow-wrap: anywhere;
}

/* A button beside a field lines up with its control, not with its label. */
.session-context-attach {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: var(--space-2);
  align-items: end;
}
</style>
