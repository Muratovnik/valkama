<script setup lang="ts">
/**
 * Start one attempt, offering only what the chosen client will accept.
 *
 * Every list here comes from `/api/execution/capabilities` rather than from a
 * literal in this file, and that is the point of the layer. A hard-coded form
 * offers every client every option and lets the client refuse afterwards: it
 * offered Codex an effort called `max`, which that client rejects, and hid
 * `minimal`, which it accepts. It also offered the executor role identically on
 * both clients, though only one of them can actually take delegation away.
 *
 * A client that is not installed stays in the chooser and says why. Removing it
 * would make a machine with no Codex look like a Valkama that has never heard
 * of Codex, which is a different and wrong answer.
 */
import { computed, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import type { ExecutionCapabilities, ExecutionDriver } from '@/shared/api/executionModel.ts'
import type { LaunchPacket } from '@/shared/types/launch.ts'
import type { ChoiceOption } from '@/shared/ui/choiceControls.ts'
import DialogFrame from '@/shared/ui/DialogFrame.vue'
import SelectionControl from '@/shared/ui/SelectionControl.vue'
import VButton from '@/shared/ui/VButton.vue'
import VField from '@/shared/ui/VField.vue'
import VTextInput from '@/shared/ui/VTextInput.vue'

const props = defineProps<{
  busy: boolean
  capabilities: ExecutionCapabilities | null
  error: string
  open: boolean
  reference: string
  repo: string
  title: string
}>()

const emit = defineEmits<{ close: []; submit: [packet: LaunchPacket] }>()

const { t } = useI18n()
const modelListId = `launch-models-${useId()}`

const client = ref('')
const role = ref('executor')
const environment = ref('workdir')
const repo = ref('')
const branch = ref('')
const distro = ref('')
const model = ref('')
const effort = ref('')
const expectedEffect = ref('change_required')
const reviewMode = ref('')
const prompt = ref('')

const drivers = computed<readonly ExecutionDriver[]>(() => props.capabilities?.drivers ?? [])

const driver = computed(() => drivers.value.find((entry) => entry.client === client.value) ?? null)

// Opening is what resets the form: a dialog that kept the last attempt's prompt
// would hand the next work item a task description written for another one.
watch(
  [() => props.open, () => props.capabilities],
  ([isOpen, capabilities]) => {
    if (!isOpen) return
    const ready = capabilities?.drivers.find((entry) => entry.health === 'ready')
    client.value = ready?.client ?? capabilities?.drivers[0]?.client ?? ''
    role.value = capabilities?.roles[0] ?? 'executor'
    environment.value = capabilities?.environments[0] ?? 'workdir'
    expectedEffect.value = capabilities?.expected_effects[0] ?? 'change_required'
    repo.value = props.repo
    branch.value = ''
    distro.value = ''
    model.value = ''
    effort.value = ''
    reviewMode.value = ''
    prompt.value = ''
  },
  { immediate: true },
)

// An effort chosen for one client is not a value another client has. Clearing it
// on the switch is what stops the form submitting a packet the server refuses.
watch(client, () => {
  effort.value = ''
  model.value = ''
})

const clientOptions = computed<ChoiceOption[]>(() =>
  drivers.value.map((entry) => ({
    value: entry.client,
    label:
      entry.health === 'ready'
        ? entry.client
        : t('launch.clientUnavailable', { client: entry.client }),
  })),
)

const roleOptions = computed<ChoiceOption[]>(() =>
  (props.capabilities?.roles ?? []).map((value) => ({ value, label: t(`launch.role.${value}`) })),
)

const environmentOptions = computed<ChoiceOption[]>(() =>
  (props.capabilities?.environments ?? []).map((value) => ({
    value,
    label: t(`launch.environment.${value}`),
  })),
)

const effortOptions = computed<ChoiceOption[]>(() => [
  { value: '', label: t('launch.clientDefault') },
  ...(driver.value?.efforts ?? []).map((value) => ({ value, label: value })),
])

const effectOptions = computed<ChoiceOption[]>(() =>
  (props.capabilities?.expected_effects ?? []).map((value) => ({
    value,
    label: t(`launch.effect.${value}`),
  })),
)

const reviewOptions = computed<ChoiceOption[]>(() =>
  (props.capabilities?.review_modes ?? []).map((value) => ({
    value,
    label: value ? t(`launch.review.${value}`) : t('launch.review.none'),
  })),
)

/** A `list` pointing at an empty datalist opens on nothing, so it must be absent. */
const modelListMark = computed(() => (driver.value?.models.length ? modelListId : undefined))

/**
 * What this client cannot honour, said before the attempt rather than after it.
 * Each line is a capability the driver reports false, so the note appears and
 * disappears with the chooser instead of being a sentence about one client.
 */
const advisories = computed(() => {
  const chosen = driver.value
  if (!chosen) return []
  const notes: string[] = []
  if (chosen.health !== 'ready') notes.push(chosen.unavailable_reason)
  if (role.value === 'executor' && !chosen.mechanical_executor)
    notes.push(t('launch.advisoryExecutor', { client: chosen.client }))
  if (!chosen.assigns_session_identity) notes.push(t('launch.advisoryIdentity'))
  if (chosen.telemetry_configuration === 'client-config')
    notes.push(t('launch.advisoryTelemetry', { client: chosen.client }))
  return notes
})

/** What a review of this mode must return, as one readable sentence fragment. */
const verdicts = computed(() =>
  reviewMode.value ? (props.capabilities?.review_verdicts[reviewMode.value] ?? []).join(', ') : '',
)

const submittable = computed(
  () => !props.busy && Boolean(client.value) && repo.value.trim().length > 0,
)

function submit() {
  if (!submittable.value) return
  emit('submit', {
    work_item: props.reference,
    client: client.value,
    role: role.value as LaunchPacket['role'],
    environment: environment.value as LaunchPacket['environment'],
    repo: repo.value.trim(),
    branch: branch.value.trim(),
    distro: distro.value.trim(),
    model: model.value.trim(),
    effort: effort.value,
    expected_effect: expectedEffect.value as LaunchPacket['expected_effect'],
    review_mode: reviewMode.value as LaunchPacket['review_mode'],
    prompt: prompt.value,
  })
}
</script>

<template>
  <DialogFrame
    :open="open"
    :busy="busy"
    :error="error"
    :title="t('launch.title')"
    :subtitle="t('launch.subtitle')"
    :context="`${reference} · ${title}`"
    :close-label="t('workItem.cancel')"
    @close="emit('close')"
    @submit="submit"
  >
    <div class="launch-grid">
      <VField
        as="div"
        :label="t('launch.client')"
      >
        <SelectionControl
          v-model="client"
          mode="combobox"
          :options="clientOptions"
          :label="t('launch.client')"
        />
      </VField>
      <VField
        as="div"
        :label="t('launch.roleLabel')"
      >
        <SelectionControl
          v-model="role"
          mode="combobox"
          :options="roleOptions"
          :label="t('launch.roleLabel')"
        />
      </VField>
      <VField
        as="div"
        :label="t('launch.environmentLabel')"
      >
        <SelectionControl
          v-model="environment"
          mode="combobox"
          :options="environmentOptions"
          :label="t('launch.environmentLabel')"
        />
      </VField>
      <VField
        as="div"
        :label="t('launch.effort')"
      >
        <SelectionControl
          v-model="effort"
          mode="combobox"
          :options="effortOptions"
          :label="t('launch.effort')"
        />
      </VField>
      <div class="launch-model">
        <VTextInput
          v-model="model"
          :label="t('launch.model')"
          :list="modelListMark"
          :maxlength="120"
          :placeholder="t('launch.clientDefault')"
        />
        <datalist
          v-if="driver?.models.length"
          :id="modelListId"
        >
          <option
            v-for="name in driver.models"
            :key="name"
            :value="name"
          />
        </datalist>
      </div>
      <VField
        as="div"
        :label="t('launch.effectLabel')"
      >
        <SelectionControl
          v-model="expectedEffect"
          mode="combobox"
          :options="effectOptions"
          :label="t('launch.effectLabel')"
        />
      </VField>
      <VField
        as="div"
        :label="t('launch.reviewLabel')"
      >
        <SelectionControl
          v-model="reviewMode"
          mode="combobox"
          :options="reviewOptions"
          :label="t('launch.reviewLabel')"
        />
      </VField>
      <VTextInput
        v-if="environment === 'worktree'"
        v-model="branch"
        :label="t('launch.branch')"
        :hint="t('launch.branchHint')"
        :maxlength="120"
      />
      <VTextInput
        v-if="environment === 'wsl'"
        v-model="distro"
        :label="t('launch.distro')"
        :hint="t('launch.distroHint')"
        :maxlength="64"
      />
    </div>

    <VTextInput
      v-model="repo"
      class="launch-wide"
      :label="t('launch.repo')"
      :hint="t('launch.repoHint')"
      :maxlength="512"
    />
    <VTextInput
      v-model="prompt"
      class="launch-wide"
      :label="t('launch.prompt')"
      :hint="t('launch.promptHint')"
      :rows="5"
      :maxlength="capabilities?.max_prompt_chars ?? 8000"
    />

    <p
      v-if="verdicts"
      class="launch-note"
    >
      {{ t('launch.verdicts', { verdicts }) }}
    </p>
    <ul
      v-if="advisories.length"
      class="launch-advisories"
    >
      <li
        v-for="note in advisories"
        :key="note"
      >
        {{ note }}
      </li>
    </ul>

    <template #footer>
      <VButton @click="emit('close')">{{ t('workItem.cancel') }}</VButton>
      <VButton
        variant="primary"
        type="submit"
        :disabled="!submittable"
      >
        {{ t('launch.start') }}
      </VButton>
    </template>
  </DialogFrame>
</template>

<style scoped>
.launch-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--space-4);
  min-width: 0;
}

.launch-model {
  min-width: 0;
}

.launch-wide {
  margin-top: var(--space-4);
}

.launch-note {
  margin: var(--space-3) 0 0;
  color: var(--color-text-muted);
  font: var(--font-detail);
}

.launch-advisories {
  display: grid;
  gap: var(--space-1);
  padding: 0;
  margin: var(--space-3) 0 0;
  color: var(--color-warning);
  font: var(--font-detail);
  list-style: none;
}

@container overlay (width >= 600px) {
  .launch-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
