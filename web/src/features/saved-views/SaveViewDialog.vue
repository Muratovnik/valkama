<script setup lang="ts">
/**
 * The name a view is saved under, asked in a small dialog because the menu that
 * offers «Save view…» closes when it is chosen, as a menu does, and a phone's bar
 * has no room for a field of its own.
 *
 * The field takes focus as the dialog opens: the reader opened it to type a name.
 * A name the space already has is said before it is saved, since saving replaces
 * that view's state.
 */
import { computed, ref, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { VIEW_NAME_CHARS, viewName } from '@/shared/lib/savedViews.ts'
import DialogFrame from '@/shared/ui/DialogFrame.vue'
import VButton from '@/shared/ui/VButton.vue'
import VTextInput from '@/shared/ui/VTextInput.vue'

const props = defineProps<{
  open: boolean
  /** The names the space already has. */
  taken: readonly string[]
}>()

const emit = defineEmits<{ close: []; save: [name: string] }>()

const { t } = useI18n()

const name = ref('')
// Each open starts from an empty field.
watch(
  () => props.open,
  (open) => {
    if (open) name.value = ''
  },
)
/**
 * The caret goes into the field as the field appears, which is when the dialog has
 * drawn what it holds; the dialog's own first focus then finds focus inside it and
 * leaves it there.
 */
const field = useTemplateRef<{ control: () => HTMLInputElement | null }>('field')
watch(field, (shown) => shown?.control()?.focus(), { flush: 'post' })

const kept = computed(() => viewName(name.value))
const replaces = computed(() => props.taken.includes(kept.value))
/** Said under the field only when saving would replace a view of the same name. */
const hint = computed(() => (replaces.value ? t('workItem.saveView.replaces') : undefined))

function submit() {
  if (!kept.value) return
  emit('save', kept.value)
}
</script>

<template>
  <DialogFrame
    :open="open"
    :title="t('workItem.saveView.title')"
    :subtitle="t('workItem.saveView.subtitle')"
    :close-label="t('workItem.saveView.cancel')"
    @close="emit('close')"
    @submit="submit"
  >
    <VTextInput
      ref="field"
      v-model="name"
      autocomplete="off"
      :label="t('workItem.saveView.name')"
      :maxlength="VIEW_NAME_CHARS"
      :hint="hint"
    />
    <template #footer>
      <VButton @click="emit('close')">{{ t('workItem.saveView.cancel') }}</VButton>
      <VButton
        variant="primary"
        type="submit"
        :disabled="!kept"
        >{{ t('workItem.saveView.save') }}</VButton
      >
    </template>
  </DialogFrame>
</template>
