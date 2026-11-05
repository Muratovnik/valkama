<script setup lang="ts">
/**
 * What stands under an entry while its points are being made steps: the form, and once the
 * steps are written a line saying how many, with the way to the checklist they joined.
 *
 * The steps join the checklist above the discussion when the card is read again, after the
 * form has gone, and the list growing there pushed the line below the fold. So the read that
 * brings the longer checklist brings the line back into view once it is drawn, and no later
 * read does: a reader who has scrolled away since is not pulled back.
 */
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { useEntrySteps } from '@/widgets/work-item-inspector/utils/entrySteps.ts'
import type { ThreadComment } from '@/widgets/work-item-inspector/utils/threadRows.ts'

import StepsFromComment from '@/features/discussion-thread/components/StepsFromComment.vue'

import VButton from '@/shared/ui/VButton.vue'

const props = defineProps<{ busy: boolean; entry: ThreadComment; threadKey: string }>()
const { t } = useI18n()
const { added, card, forms, open, points, send } = useEntrySteps(
  () => props.entry,
  () => props.threadKey,
)
const error = computed(() => forms.errorAt(props.threadKey, 'steps'))
const pending = computed(() => props.busy || forms.pending.value)
const steps = computed(() => card?.item().checklist ?? [])

const line = ref<HTMLElement | null>(null)
/** How many steps the card had when this entry's steps were sent, until they are shown. */
let before: number | null = null
function submit(chosen: string[]) {
  before = steps.value.length
  send(chosen)
}
watch(
  () => steps.value.length,
  (now) => {
    if (before === null || now === before) return
    before = null
    if (added.value) line.value?.scrollIntoView({ block: 'nearest' })
  },
  { flush: 'post' },
)
</script>

<template>
  <StepsFromComment
    v-if="open && card"
    :error="error"
    :pending="pending"
    :points="points"
    :steps="steps"
    @cancel="forms.cancel"
    @refresh="card.refresh"
    @submit="submit"
  />
  <p
    v-else-if="added && card"
    ref="line"
    class="entry-steps-added"
    role="status"
  >
    {{ t('commentSteps.added', added) }}
    <VButton
      variant="ghost"
      size="inline"
      @click="card.reveal"
      >{{ t('commentSteps.toChecklist') }}</VButton
    >
  </p>
</template>

<style scoped>
.entry-steps-added {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  align-items: center;
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-detail);
}
</style>
