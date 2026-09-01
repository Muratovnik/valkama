<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import AnalyzerRuntimeFields from '@/features/improvement-profile/components/AnalyzerRuntimeFields.vue'

import type { ImprovementProfile } from '@/entities/improvement/utils/improvementDerivations.ts'

import type { ChoiceOption } from '@/shared/ui/choiceControls.ts'
import DialogFrame from '@/shared/ui/DialogFrame.vue'
import SelectionControl from '@/shared/ui/SelectionControl.vue'
import ToggleSwitch from '@/shared/ui/ToggleSwitch.vue'
import VButton from '@/shared/ui/VButton.vue'
import VField from '@/shared/ui/VField.vue'
import VTextInput from '@/shared/ui/VTextInput.vue'

const props = defineProps<{
  open: boolean
  profile: ImprovementProfile | null
  saving: boolean
}>()
const emit = defineEmits<{
  close: []
  save: [profile: ImprovementProfile]
}>()
const { t } = useI18n()
const draft = ref<ImprovementProfile | null>(null)
/** A submit button that says it is working, rather than one that only looks idle. */
const saveLabel = computed(() =>
  props.saving ? t('improvements.savingProfile') : t('improvements.saveProfile'),
)
const missingRequired = computed(() =>
  Boolean(
    draft.value?.enabled &&
    (!draft.value.purpose.trim() ||
      !draft.value.expected_behavior.trim() ||
      !draft.value.planning_space.trim()),
  ),
)
const analyzerOptions = computed<ChoiceOption[]>(() => [
  { value: 'codex', label: 'Codex', icon: 'codex' },
  { value: 'claude', label: 'Claude Code', icon: 'claude' },
])
const scheduleOptions = computed<ChoiceOption[]>(() => [
  { value: 'manual', label: t('improvements.manual') },
  { value: 'scheduled', label: t('improvements.scheduled') },
])

function cloneProfile(profile: ImprovementProfile | null): ImprovementProfile | null {
  return profile ? (JSON.parse(JSON.stringify(profile)) as ImprovementProfile) : null
}

// The draft is taken when the dialog opens. Watching the profile object as
// well meant a background refresh mid-edit replaced the operator's unsaved
// draft with the stored profile.
watch(
  () => props.open,
  (open) => {
    if (open) draft.value = cloneProfile(props.profile)
  },
  { immediate: true },
)
</script>

<template>
  <DialogFrame
    v-if="draft"
    surface-class="analysis-settings-dialog"
    :open="open"
    :title="t('improvements.settingsTitle')"
    :subtitle="t('improvements.profileIntro')"
    :close-label="t('drawer.close')"
    :busy="saving"
    @close="emit('close')"
    @submit="emit('save', draft)"
  >
    <div class="profile-toggle">
      <ToggleSwitch
        v-model="draft.enabled"
        :label="t('improvements.enabled')"
        :on-label="t('settings.enabled')"
        :off-label="t('settings.disabled')"
        :show-state-label="false"
      />
      <span>
        {{ t('improvements.enabled') }}
        <small class="profile-toggle-note">{{ t('improvements.disabledNote') }}</small>
      </span>
    </div>

    <div class="profile-intent-fields">
      <VTextInput
        v-model="draft.purpose"
        class="profile-text"
        :label="t('improvements.purpose')"
        :rows="4"
      />
      <VTextInput
        v-model="draft.expected_behavior"
        class="profile-text"
        :label="t('improvements.expectedBehavior')"
        :rows="4"
      />
    </div>

    <section
      class="profile-section"
      :aria-label="t('improvements.runtimeSettings')"
    >
      <div>
        <h3 class="profile-section-title">{{ t('improvements.runtimeSettings') }}</h3>
        <p class="profile-section-note">
          {{ t('improvements.runtimeSettingsIntro') }}
        </p>
      </div>
      <div class="profile-runtime-fields">
        <VField
          as="div"
          :label="t('improvements.analyzer')"
        >
          <SelectionControl
            mode="combobox"
            :model-value="draft.analyzer_client"
            :options="analyzerOptions"
            :label="t('improvements.analyzer')"
            @update:model-value="draft.analyzer_client = $event as 'codex' | 'claude'"
          />
        </VField>
        <AnalyzerRuntimeFields
          :client="draft.analyzer_client"
          :model="draft.analyzer_model"
          :effort="draft.reasoning_effort"
          @update:model="draft.analyzer_model = $event"
          @update:effort="draft.reasoning_effort = $event"
        />
      </div>
    </section>

    <section
      class="profile-section"
      :aria-label="t('improvements.deliverySettings')"
    >
      <h3 class="profile-section-title">{{ t('improvements.deliverySettings') }}</h3>
      <div class="profile-delivery-fields">
        <VTextInput
          v-model="draft.planning_space"
          :label="t('improvements.planningSpace')"
        />
        <VField
          as="div"
          :label="t('improvements.schedule')"
        >
          <SelectionControl
            :model-value="draft.schedule.mode"
            :options="scheduleOptions"
            :label="t('improvements.schedule')"
            @update:model-value="draft.schedule.mode = $event as 'manual' | 'scheduled'"
          />
        </VField>
        <VTextInput
          v-if="draft.schedule.mode === 'scheduled'"
          type="number"
          min="1"
          max="720"
          :model-value="draft.schedule.interval_hours"
          :label="t('improvements.intervalHours')"
          @update:model-value="draft.schedule.interval_hours = Number($event)"
        />
      </div>
    </section>
    <template #footer>
      <p
        v-if="missingRequired"
        class="profile-alert"
        role="alert"
      >
        {{ t('improvements.profileRequired') }}
      </p>
      <VButton
        variant="ghost"
        @click="emit('close')"
      >
        {{ t('composer.cancel') }}
      </VButton>
      <VButton
        variant="primary"
        type="submit"
        :disabled="saving || missingRequired"
      >
        {{ saveLabel }}
      </VButton>
    </template>
  </DialogFrame>
</template>

<style scoped>
:global(.analysis-settings-dialog) {
  /* stylelint-disable-next-line declaration-no-important -- reka-ui sizes its own
     dialog content; this is the app overruling a third-party default */
  width: min(780px, calc(100vw - 40px)) !important;
  overflow: hidden;
}

.profile-toggle {
  display: flex;
  gap: var(--space-3);
  align-items: center;
  min-height: var(--size-control-target);
  padding-bottom: var(--space-4);
  border-bottom: 1px solid var(--color-rule);
  font: var(--font-label);
}

.profile-toggle-note {
  display: block;
  margin-top: var(--space-1);
  color: var(--color-text-muted);
  font-weight: 400;
}

.profile-intent-fields,
.profile-runtime-fields,
.profile-delivery-fields {
  display: grid;
  gap: var(--space-4);
}

.profile-text {
  --size-text-area-min-height: 112px;
}

.profile-section {
  display: grid;
  gap: var(--space-4);
  padding-top: var(--space-5);
  border-top: 1px solid var(--color-rule);
}

.profile-section-title {
  margin: 0;
  font: var(--font-emphasis);
}

.profile-section-note {
  margin-top: var(--space-1);
  color: var(--color-text-muted);
  font: var(--font-note);
}

.profile-alert {
  max-width: 46ch;
  margin-right: auto;
  color: var(--color-danger);
  font: var(--font-detail);
}

/* Three viewport breakpoints for a dialog that stops growing at 640px: past a
   680px window the box never changed again, so 768 and 1024 were rearranging
   fields on news about the monitor. Asking the dialog leaves the two states it
   can actually be in, and drops the three-column delivery row that gave each
   field 200px inside a 640px box. */
@container overlay (width >= 600px) {
  .profile-runtime-fields {
    grid-template-columns: minmax(150px, 0.55fr) minmax(0, 1.45fr);
  }

  .profile-delivery-fields,
  .profile-intent-fields {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
