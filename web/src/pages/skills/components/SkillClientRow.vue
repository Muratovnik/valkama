<script setup lang="ts">
/**
 * One client's row inside a skill: who it is, whether the skill is switched on
 * for it, and what refused the last time that was changed.
 *
 * The switch is a write, so the row owns it. The section used to hold every
 * row's state at once — two `Record<string, boolean>` maps keyed by a composite
 * of skill and client — because a model derived from a list has nowhere to be
 * assigned, and a shared map is how a row was then told that it is the busy one.
 * A row that owns its model needs neither: `v-model` writes back where the value
 * was read, and `pending` is a boolean about this row.
 *
 * The composite key was guarding something real, and the guard moved to the
 * `v-for` key rather than disappearing: the drawer keeps this list while the
 * reader moves down the catalogue, so a row keyed by client alone would be
 * reused across skills and carry a spinner from one of them to the next.
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { skillPresentation } from '@/pages/skills/utils/skillPresentation.ts'

import { updateSkillActivation } from '@/entities/skill/api/skillsApi'

import type { SkillClient, SkillEntry, SkillsPayload } from '@/shared/types/skills.ts'
import SemanticState from '@/shared/ui/SemanticState.vue'
import ToggleSwitch from '@/shared/ui/ToggleSwitch.vue'
import VIcon from '@/shared/ui/VIcon.vue'

const props = defineProps<{ client: SkillClient; skill: SkillEntry }>()
const emit = defineEmits<{ updated: [payload: SkillsPayload] }>()

const { t, te, locale } = useI18n()
const { clientIcon, clientLabel, clientStateLabel, reasonLabel } = skillPresentation(
  t,
  te,
  () => locale.value,
)

const pending = ref(false)
const failed = ref(false)

/** What the payload says about this skill for this client. */
const activation = computed(() => props.skill.clients[props.client])

/**
 * On or off, with the server as the only source of the answer.
 *
 * `enabled` is nullable on the wire — unknown is a third thing a client can
 * report — and a switch has two positions, so unknown reads as off. The setter
 * is the write, and the server answers it with the whole inventory, which is
 * what `updated` carries up: whether a skill is on is not a local fact.
 */
const enabled = computed({
  get: () => activation.value.enabled === true,
  set: (next) => void apply(next),
})
const toggleable = computed(() => activation.value.can_toggle && activation.value.enabled !== null)
const activationState = computed(() => {
  if (activation.value.enabled === null || activation.value.status === 'unavailable')
    return 'unavailable'
  return activation.value.enabled ? 'enabled' : 'disabled'
})

async function apply(next: boolean) {
  const { key } = props.skill
  const client = props.client
  pending.value = true
  failed.value = false
  try {
    emit('updated', await updateSkillActivation(key, client, next))
  } catch {
    failed.value = true
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <div class="client-activation-row">
    <div class="client-identity">
      <VIcon
        :name="clientIcon(props.client)"
        :size="20"
      />
      <span class="client-copy"
        ><strong class="client-name">{{ clientLabel(props.client) }}</strong
        ><small class="client-state">{{ clientStateLabel(activation) }}</small></span
      >
    </div>
    <ToggleSwitch
      v-if="toggleable"
      v-model="enabled"
      :label="
        t('skills.toggleLabel', { client: clientLabel(props.client), skill: props.skill.name })
      "
      :on-label="t('skills.clientStatus.enabled')"
      :off-label="t('skills.clientStatus.disabled')"
      :show-state-label="false"
      :busy="pending"
    />
    <SemanticState
      v-else
      dimension="skill-readiness"
      :state="activationState"
      :label="clientStateLabel(activation)"
    />
    <p
      v-if="activation.reason"
      class="client-note"
    >
      {{ reasonLabel(activation.reason) }}
    </p>
    <p
      v-if="failed"
      class="client-note client-error"
      role="alert"
    >
      {{ t('skills.updateError') }}
    </p>
  </div>
</template>

<style scoped>
.client-activation-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 0 var(--space-3);
  align-items: center;
  padding: var(--space-2) var(--space-3);
  background: var(--color-surface-muted);
  border-radius: var(--radius-status);
}

.client-identity {
  display: flex;
  gap: var(--space-3);
  align-items: center;
  min-width: 0;
}

.client-copy {
  display: grid;
  gap: var(--space-half);
  min-width: 0;
}

.client-name {
  font-size: var(--font-size-interface);
}

.client-state {
  color: var(--color-text-muted);
  font-size: var(--font-size-dense);
}

/* The note runs under both columns, so it is a row of the same grid rather than
   a block of its own. It used to carry `!important` on its size and its colour,
   because the drawer's own prose rule reached in here and outranked it; the
   section owns its paragraphs now and the override went with the reach. */
.client-note {
  grid-column: 1/-1;
  padding-top: var(--space-1);
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-paragraph-dense);
}

.client-error {
  color: var(--color-danger);
}
</style>
