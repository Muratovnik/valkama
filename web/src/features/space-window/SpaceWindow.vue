<script setup lang="ts">
/**
 * The owner's window for one space of the main store: its name, its key, its projects and
 * which of them is the default, saved as one write. The same window creates a space.
 *
 * The key is the server's for the name until the reader types one, and can be typed until the
 * space has issued a number: from then on it is in those numbers, and the window shows it as
 * text with that reason; while the key's error says why it cannot be sent, which states the
 * key's form, no hint says the form again; the field holds the room of every hint and reason it
 * can come to say, so neither moves what stands under it. A renamed space says under its name
 * what a new name changes, in a room the edit holds for it, so the fields under the name stay
 * where they stood.
 *
 * A space with no work items can be removed, after a question asked in the window; one with
 * work has no Remove, and where the foot cannot hold all three the way out and the save change
 * lines together. A refused save keeps what was typed and says why through the dialog's own
 * error, seen above the foot's buttons however long the form (`DialogFrame`). A save whose space
 * stood while the registry refused its projects says so above the fields, and its button
 * becomes «Retry binding», which saves the same draft as that space's edit.
 *
 * Its parts are `data-part` `notice`, `key-locked`, `workflow` and `remove`.
 */
import { computed, ref, useId, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { draftChanged, projectChoices } from '@/features/space-window/spaceDraft.ts'
import SpaceProjects from '@/features/space-window/SpaceProjects.vue'
import { useSpaceWindowState } from '@/features/space-window/spaceWindowHost.ts'
import { useSpaceWindowForm } from '@/features/space-window/useSpaceWindowForm.ts'

import { placeFocus } from '@/shared/lib/scriptedFocus.ts'
import ConfirmStrip from '@/shared/ui/ConfirmStrip.vue'
import DialogFrame from '@/shared/ui/DialogFrame.vue'
import VButton from '@/shared/ui/VButton.vue'
import VTextInput from '@/shared/ui/VTextInput.vue'

/** Eight of the widest letter, the most room a key of 2 to 8 letters and digits takes. */
const WIDEST_KEY = 'W'.repeat(8)

const { t } = useI18n()
const host = useSpaceWindowState()
const target = computed(() => host?.target.value ?? null)
const opened = computed(() => target.value !== null)
const close = () => host?.close()
const {
  draft,
  error,
  gap,
  keyError,
  keyReasons,
  notice,
  origin,
  phase,
  registered,
  registryKnown,
  remove,
  retry,
  save,
  saving,
  typeKey,
  workflow,
} = useSpaceWindowForm(target, (outcome, closes) => {
  host?.saved(outcome)
  if (closes) close()
})

const asking = ref(false)
watch(target, () => {
  asking.value = false
})

const title = computed(() =>
  origin.value === null
    ? t('spaceWindow.create')
    : t('spaceWindow.editTitle', { key: origin.value.key }),
)
const ready = computed(() => phase.value === 'ready')
const renamed = computed(
  () => origin.value !== null && draft.value.name.trim() !== origin.value.name,
)
const keyLocked = computed(() => origin.value?.keyLocked === true)
const keyMoves = computed(
  () => origin.value !== null && !keyLocked.value && draft.value.key !== origin.value.key,
)
/** What the key's field says under it; nothing while its error says why, which states the form. */
const keyHint = computed(() => {
  if (keyError.value) return ''
  if (keyMoves.value) return t('spaceWindow.keyMoves')
  return draft.value.key
    ? t('spaceWindow.keyHint', { key: draft.value.key })
    : t('spaceWindow.keyForm')
})
/**
 * Every hint and reason the key's field can come to say, whose room it holds from the start, so
 * a reason appearing or another taking its place moves nothing under the field: given room only
 * while it stood, a reason a line longer than the hint pushed the projects down. The hint that
 * names the key holds the room of the widest key there can be.
 */
const keyWords = computed(() => ({
  hints: [
    t('spaceWindow.keyHint', { key: WIDEST_KEY }),
    t(origin.value ? 'spaceWindow.keyMoves' : 'spaceWindow.keyForm'),
  ],
  errors: keyReasons.value,
}))
const choices = computed(() =>
  projectChoices(draft.value, registered.value, origin.value?.ref ?? null),
)
const takenIds = computed(() => registered.value.map((project) => project.project_id))
const removable = computed(() => origin.value !== null && origin.value.workItems === 0)
/** Saved as it stands, the edit would change nothing: its button waits for a change. */
const unchanged = computed(
  () => origin.value !== null && !notice.value && !draftChanged(draft.value, origin.value),
)
/**
 * A save sends the space's whole list of projects, so an edit made while the registry could not
 * be read would send none and take every project out of the space: it waits for a read.
 */
const sendable = computed(
  () =>
    ready.value &&
    gap.value === null &&
    !keyError.value &&
    !unchanged.value &&
    (registryKnown.value || origin.value === null),
)
const registryLine = computed(() =>
  t(origin.value === null ? 'spaceWindow.registryUnreadableNew' : 'spaceWindow.registryUnreadable'),
)
const closeLabel = computed(() => (notice.value ? t('spaceWindow.close') : t('spaceWindow.cancel')))
const busy = computed(() => saving.value || phase.value === 'reading')
/**
 * What a new name changes, said under the name once it differs from the space's, in a room the
 * edit holds for it from the start: given room only as it came, it pushed the whole form down
 * under the caret at the first letter typed.
 */
const renameWords = computed(() =>
  origin.value ? t('spaceWindow.renamed', { key: origin.value.key }) : '',
)
const renameHintId = useId()
/** The name is described by what a new name changes while it stands, and by nothing before. */
const nameDescribedBy = computed(() => (renamed.value ? renameHintId : undefined))
/**
 * A new space's caret goes into its name as the field appears: the reader opened the window
 * to type one. An edit leaves focus where the dialog puts it.
 */
const nameField = useTemplateRef<{ control: () => HTMLInputElement | null }>('nameField')
watch(
  nameField,
  (shown) => {
    if (origin.value === null) placeFocus(shown?.control())
  },
  { flush: 'post' },
)
const submitLabel = computed(() => {
  if (notice.value) return t('spaceWindow.retryBinding')
  return origin.value === null ? t('spaceWindow.createButton') : t('spaceWindow.save')
})
</script>

<template>
  <DialogFrame
    :open="opened"
    :title="title"
    :close-label="closeLabel"
    :busy="busy"
    :error="error"
    steady-scroll
    @close="close"
    @submit="save"
  >
    <p
      v-if="notice"
      class="space-notice"
      role="status"
      data-part="notice"
    >
      {{ notice }}
    </p>
    <p
      v-if="phase === 'reading'"
      class="space-reading"
    >
      {{ t('spaceWindow.reading') }}
    </p>
    <div
      v-else-if="phase === 'failed'"
      class="space-failed"
      role="alert"
    >
      <p class="space-failed-text">{{ t('spaceWindow.readFailed') }}</p>
      <VButton @click="retry">{{ t('spaceWindow.retry') }}</VButton>
    </div>
    <template v-else>
      <div class="space-name">
        <VTextInput
          ref="nameField"
          v-model="draft.name"
          autocomplete="off"
          :label="t('spaceWindow.name')"
          :maxlength="200"
          :describedby="nameDescribedBy"
        />
        <div
          v-if="origin"
          class="held-room"
        >
          <small
            v-if="renamed"
            :id="renameHintId"
            class="space-name-hint"
            >{{ renameWords }}</small
          >
          <small
            class="held-room-unseen space-name-hint"
            aria-hidden="true"
            >{{ renameWords }}</small
          >
        </div>
      </div>
      <div
        v-if="keyLocked && origin"
        class="space-key-locked"
        data-part="key-locked"
      >
        <span class="space-key-label">{{ t('spaceWindow.key') }}</span>
        <span
          ><strong class="space-key-value">{{ origin.key }}</strong> —
          {{ t('spaceWindow.keyLocked') }}</span
        >
      </div>
      <VTextInput
        v-else
        autocomplete="off"
        :model-value="draft.key"
        :label="t('spaceWindow.key')"
        :maxlength="8"
        :spellcheck="false"
        :hint="keyHint"
        :error="keyError"
        :held-words="keyWords"
        @update:model-value="typeKey"
      />
      <SpaceProjects
        v-if="registryKnown"
        v-model="draft"
        :choices="choices"
        :disabled="saving"
        :taken-ids="takenIds"
      />
      <p
        v-else
        class="space-registry-unread"
        role="status"
      >
        {{ registryLine }}
      </p>
      <p
        v-if="workflow"
        class="space-workflow"
        data-part="workflow"
      >
        <span class="space-key-label">{{ t('spaceWindow.workflow') }}</span>
        <span
          >{{ t('spaceWindow.workflowLine', { name: workflow.name, count: workflow.states }) }}
          <span class="space-quiet">— {{ t('spaceWindow.workflowFixed') }}</span></span
        >
      </p>
      <ConfirmStrip
        v-if="asking && origin"
        tone="danger"
        :message="t('spaceWindow.removeAsk', { key: origin.key })"
        :cancel-label="t('spaceWindow.removeKeep')"
        :confirm-label="t('spaceWindow.removeGo')"
        @cancel="asking = false"
        @confirm="remove"
      />
    </template>
    <template #footer>
      <VButton
        v-if="ready && removable && !asking"
        class="space-remove"
        variant="danger"
        data-part="remove"
        :disabled="saving"
        @click="asking = true"
        >{{ t('spaceWindow.remove') }}</VButton
      >
      <span class="space-foot-pair">
        <VButton @click="close">{{ closeLabel }}</VButton>
        <VButton
          variant="primary"
          type="submit"
          :disabled="!sendable || saving"
          >{{ submitLabel }}</VButton
        >
      </span>
    </template>
  </DialogFrame>
</template>

<style scoped src="@/shared/ui/heldRoom.css"></style>

<style scoped>
/* The name's field and what a new name changes, as a field and its hint stand. */
.space-name {
  display: grid;
  gap: var(--space-label-value);
  min-width: 0;
}

.space-name-hint {
  color: var(--color-text-muted);
  font: var(--font-detail);
}

/* The way out and the save change lines together: where the foot cannot hold all three, Remove
   stands alone on the first line and the two on the next, rather than the save alone. */
.space-foot-pair {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
  justify-content: flex-end;
}

.space-notice {
  padding: var(--space-3) var(--space-4);
  margin: 0;
  font-size: var(--font-size-dense);
  background: var(--color-surface-muted);
  border-radius: var(--radius-card);
}

.space-reading,
.space-failed-text,
.space-registry-unread {
  margin: 0;
  color: var(--color-text-muted);
}

.space-failed {
  display: grid;
  gap: var(--space-3);
  justify-items: start;
}

.space-key-locked,
.space-workflow {
  display: grid;
  gap: var(--space-1);
  margin: 0;
}

.space-key-label {
  font: var(--font-label);
}

.space-key-value {
  font-variant-numeric: tabular-nums;
}

.space-quiet {
  color: var(--color-text-muted);
}

/* Remove stands apart from the way out and the save, at the foot's start. */
.space-remove {
  margin-inline-end: auto;
}
</style>
