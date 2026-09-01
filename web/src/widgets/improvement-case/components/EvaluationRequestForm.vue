<script setup lang="ts">
/**
 * Where an operator names a checkout and asks for one of the two evaluation runs.
 *
 * It owns the two fields because nothing else reads them: the parent only needs
 * to hear which phase was asked for and against what, which is what it emits.
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import VButton from '@/shared/ui/VButton.vue'
import VTextInput from '@/shared/ui/VTextInput.vue'

const props = defineProps<{ busy?: boolean }>()
const emit = defineEmits<{
  evaluate: [phase: 'baseline' | 'candidate', repo: string, git_ref: string]
}>()
const { t } = useI18n()

const repo = ref('')
const gitRef = ref('')

/** Both fields have to carry something before an evaluation can be asked for. */
const ready = computed(() => repo.value.trim().length > 0 && gitRef.value.trim().length > 0)
</script>

<template>
  <div class="eval-form">
    <VTextInput
      v-model="repo"
      :label="t('improvements.repository')"
      :placeholder="t('improvements.repositoryPlaceholder')"
    />
    <VTextInput
      v-model="gitRef"
      :label="t('improvements.gitRef')"
      :placeholder="t('improvements.gitRefPlaceholder')"
    />
    <div class="eval-actions">
      <VButton
        :disabled="props.busy || !ready"
        @click="emit('evaluate', 'baseline', repo, gitRef)"
      >
        {{ t('improvements.runBaseline') }}
      </VButton>
      <VButton
        :disabled="props.busy || !ready"
        @click="emit('evaluate', 'candidate', repo, gitRef)"
      >
        {{ t('improvements.runCandidate') }}
      </VButton>
    </div>
  </div>
</template>

<style scoped>
.eval-form {
  display: grid;
  gap: var(--space-2);
  min-width: 0;
}

.eval-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}
</style>
