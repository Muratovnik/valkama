<script setup lang="ts">
/**
 * The questions on one card, in a section that is absent while there are none:
 * nothing here asks one, so a heading and a sentence saying so held the first screen
 * for nothing. The read goes on while it is absent, on its half-minute and on the
 * window coming back, so a question arriving brings the section back by itself.
 *
 * A read that failed or could not reach every source stays, with the way to read
 * again: not knowing is not the same as there being none. When that read, asked for
 * from the section's own button, finds nothing, the button goes with the section;
 * focus takes a sentence left in its place, or it would fall to the page's top.
 */
import { computed, nextTick, ref, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import RequestList from '@/features/input-requests/components/RequestList.vue'
import { useInputRequests } from '@/features/input-requests/composables/useInputRequests.ts'

import type { InputAnswers, InputRequestEntry } from '@/shared/api/inputRequestModel.ts'
import type { PlanningTarget } from '@/shared/api/planningTarget.ts'
import SectionHeader from '@/shared/ui/SectionHeader.vue'
import VButton from '@/shared/ui/VButton.vue'
import VIcon from '@/shared/ui/VIcon.vue'

const props = defineProps<{ target: PlanningTarget }>()
const emit = defineEmits<{ changed: [entry: InputRequestEntry] }>()
const { t } = useI18n()
const { result, loading, failed, partial, entries, refresh, changed } = useInputRequests(
  () => props.target,
)
const drafts = ref<Record<string, InputAnswers>>({})
const shown = computed(() => entries.value.length > 0 || failed.value || partial.value)
const section = useTemplateRef<HTMLElement>('section')
const emptiedNote = useTemplateRef<HTMLElement>('emptied-note')
const emptied = ref(false)
watch(shown, async (now) => {
  if (now) emptied.value = false
  else if (section.value?.contains(document.activeElement)) {
    emptied.value = true
    await nextTick()
    emptiedNote.value?.focus()
  }
})
function updated(entry: InputRequestEntry) {
  changed(entry)
  emit('changed', entry)
}
</script>

<template>
  <section
    v-if="shown"
    ref="section"
    class="item-input-requests"
    :aria-label="t('requests.itemTitle')"
  >
    <!-- The section already has a heading row, so the refresh lives in it
         instead of standing alone above the message it would refresh. -->
    <SectionHeader :title="t('requests.itemTitle')">
      <template #actions>
        <VButton
          variant="ghost"
          size="inline"
          :title="t('requests.refreshItem')"
          :aria-label="t('requests.refreshItem')"
          icon
          @click="refresh"
        >
          <VIcon
            name="refresh"
            :size="16"
          />
        </VButton>
      </template>
    </SectionHeader>
    <RequestList
      :entries="entries"
      :result="result"
      :loading="loading"
      :failed="failed"
      :partial="partial"
      :drafts="drafts"
      :show-refresh="false"
      item
      @refresh="refresh"
      @updated="updated"
      @draft="(key, value) => (drafts[key] = value)"
    />
  </section>
  <p
    v-else-if="emptied"
    ref="emptied-note"
    class="visually-hidden"
    role="status"
    tabindex="-1"
  >
    {{ t('requests.itemEmpty') }}
  </p>
</template>

<style scoped>
.item-input-requests {
  display: grid;
  gap: var(--space-heading-content);
  min-width: 0;
}
</style>
