<script setup lang="ts">
/**
 * The Participation tab of Settings: at which points an agent's decision waits for the owner,
 * the queue and the periods beside them, the labels' rules and where a space's launches run.
 *
 * It shows the shared values or those of the space chosen in the context bar, starting on the
 * space. A set gives every point and switch its value at once; when the rows match no set, no
 * set is chosen and the hint says in how many rows they differ from the nearest. In a space the
 * set gives each row a value of the space's own.
 *
 * Every row writes its own change as soon as it is made (`useParticipation`); the launch place
 * is the space's record and writes through its own queue (`useSpacePlace`), so a refusal of one
 * never takes the other back.
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import ParticipationLabels from '@/pages/settings/components/ParticipationLabels.vue'
import ParticipationValueRow from '@/pages/settings/components/ParticipationValueRow.vue'
import SettingsGroup from '@/pages/settings/components/SettingsGroup.vue'
import SettingsRow from '@/pages/settings/components/SettingsRow.vue'
import SettingsScopeChoice from '@/pages/settings/components/SettingsScopeChoice.vue'
import SettingsScopedRow from '@/pages/settings/components/SettingsScopedRow.vue'
import SettingsSheet from '@/pages/settings/components/SettingsSheet.vue'
import { useParticipation } from '@/pages/settings/composables/useParticipation.ts'
import { useSpacePlace } from '@/pages/settings/composables/useSpacePlace.ts'
import { presetOf } from '@/pages/settings/utils/settingPresets.ts'

import { PARTICIPATION_POINTS, PARTICIPATION_SETS } from '@/shared/api/participationApi.ts'
import type { ParticipationSet } from '@/shared/api/participationApi.ts'
import { LAUNCH_PLACES } from '@/shared/api/planningSpaceModel.ts'
import type { PlanningSpaceRef } from '@/shared/api/platformPlanningRefs.ts'
import PlatformStatePanel from '@/shared/ui/PlatformStatePanel.vue'
import SegmentedControl from '@/shared/ui/SegmentedControl.vue'
import VButton from '@/shared/ui/VButton.vue'

const props = defineProps<{
  /** The space chosen in the context bar; null for all spaces. */
  space: PlanningSpaceRef | null
}>()

const { t } = useI18n()
const choice = ref<'global' | 'space'>('space')
const scope = computed(() => (props.space === null ? 'global' : choice.value))
const scopeKey = () => (scope.value === 'space' ? (props.space?.space_key ?? null) : null)

const { participation, panelState, load, change, failureOf } = useParticipation(scopeKey)
const spacePlace = useSpacePlace(() => props.space)

const points = computed(
  () =>
    participation.value?.values.filter((row) =>
      (PARTICIPATION_POINTS as readonly string[]).includes(row.key),
    ) ?? [],
)
const timing = computed(
  () =>
    participation.value?.values.filter(
      (row) => !(PARTICIPATION_POINTS as readonly string[]).includes(row.key),
    ) ?? [],
)

const preset = computed(() => {
  const record = participation.value
  if (record === null) return { preset: null, differing: 0 }
  const values = Object.fromEntries(record.values.map((row) => [row.key, row.value]))
  return presetOf(values, record.sets as Record<ParticipationSet, Record<string, string>>)
})
const setHint = computed(() => {
  const { preset: name, differing } = preset.value
  return name === null
    ? t('settings.scoped.customSet', { count: differing }, differing)
    : t('settings.participation.set.hint', {
        name: t(`settings.participation.set.names.${name}`),
      })
})
const setOptions = computed(() =>
  PARTICIPATION_SETS.map((value) => ({
    value,
    label: t(`settings.participation.set.names.${value}`),
  })),
)
const launchHint = computed(() => {
  const place = spacePlace.place.value
  return place === null ? '' : t(`settings.participation.launch.hints.${place}`)
})
const launchFailure = computed(() =>
  spacePlace.loadFailed.value
    ? t('settings.participation.launch.loadFailed')
    : spacePlace.failure.value,
)
const placeOptions = computed(() =>
  LAUNCH_PLACES.map((value) => ({
    value,
    label: t(`settings.participation.launch.places.${value}`),
  })),
)
</script>

<template>
  <section
    class="settings-participation"
    :aria-label="t('settings.section.participation')"
  >
    <SettingsSheet>
      <SettingsScopeChoice
        v-model="choice"
        :space="space?.space_key ?? null"
      />
      <div
        v-if="!participation"
        class="settings-participation-panel"
      >
        <PlatformStatePanel
          :state="panelState"
          compact
          @retry="load"
        />
      </div>
      <template v-else>
        <SettingsScopedRow
          data-participation-row="set"
          scope="global"
          :label="t('settings.participation.set.label')"
          :hint="setHint"
          :own="preset.preset"
          :failure="failureOf('set')"
          wide
          @update:own="(set) => change({ set: set as ParticipationSet | null })"
        >
          <template #default="{ names, value, update }">
            <SegmentedControl
              :aria-describedby="names['aria-describedby']"
              :aria-labelledby="names['aria-labelledby']"
              :label="t('settings.participation.set.label')"
              :model-value="value"
              :options="setOptions"
              wrap
              @update:model-value="update"
            />
          </template>
        </SettingsScopedRow>
        <SettingsGroup :title="t('settings.participation.decides.title')">
          <ParticipationValueRow
            v-for="row in points"
            :key="row.key"
            :row="row"
            :scope="scope"
            :failure="failureOf(`key:${row.key}`)"
            @edit="(value) => change({ key: row.key, value })"
          />
        </SettingsGroup>
        <SettingsGroup :title="t('settings.participation.timing.title')">
          <ParticipationValueRow
            v-for="row in timing"
            :key="row.key"
            :row="row"
            :scope="scope"
            :failure="failureOf(`key:${row.key}`)"
            @edit="(value) => change({ key: row.key, value })"
          />
        </SettingsGroup>
        <ParticipationLabels
          :rules="participation.labels"
          :scope="scope"
          :known="spacePlace.labels.value"
          :failure-of="(label) => failureOf(`label:${label}`)"
          @edit="change"
        />
      </template>
      <SettingsGroup
        v-if="scope === 'space'"
        :title="t('settings.participation.launch.title')"
      >
        <SettingsRow
          data-participation-row="launch"
          :label="t('settings.participation.launch.label')"
          :hint="launchHint"
          :failure="launchFailure"
          wide
        >
          <SegmentedControl
            v-if="spacePlace.place.value !== null"
            :label="t('settings.participation.launch.label')"
            :model-value="spacePlace.place.value"
            :options="placeOptions"
            wrap
            @update:model-value="spacePlace.choose"
          />
          <VButton
            v-else-if="spacePlace.loadFailed.value"
            class="settings-participation-retry"
            variant="secondary"
            size="compact"
            @click="spacePlace.load"
          >
            {{ t('platform.actions.retry') }}
          </VButton>
        </SettingsRow>
      </SettingsGroup>
    </SettingsSheet>
  </section>
</template>

<style scoped>
.settings-participation {
  width: 100%;
  min-width: 0;
}

.settings-participation-panel {
  padding: var(--space-4);
}

.settings-participation-retry {
  justify-self: start;
}
</style>
