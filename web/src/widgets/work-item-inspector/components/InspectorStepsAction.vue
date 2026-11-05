<script setup lang="ts">
/**
 * The icon on an entry's head that makes steps of the points of its list. It opens the form
 * under the entry and closes it again, and says which through `aria-expanded`.
 */
import { useI18n } from 'vue-i18n'

import { useEntrySteps } from '@/widgets/work-item-inspector/utils/entrySteps.ts'
import type { ThreadComment } from '@/widgets/work-item-inspector/utils/threadRows.ts'

import EntryAction from '@/shared/ui/EntryAction.vue'

const props = defineProps<{ busy: boolean; entry: ThreadComment; threadKey: string }>()
const { t } = useI18n()
const { offered, open, press } = useEntrySteps(
  () => props.entry,
  () => props.threadKey,
)
</script>

<template>
  <EntryAction
    v-if="offered"
    icon="steps"
    :aria-expanded="open"
    :disabled="busy"
    :label="t('commentSteps.action')"
    @click="press"
  />
</template>
