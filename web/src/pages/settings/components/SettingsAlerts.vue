<script setup lang="ts">
/**
 * The owner's Windows alerts: whether, about what, how much they say, and whether
 * Windows will show them. A browser tab shows the same screen as the desktop app,
 * because the process that wrote the event sends the alert, never a page.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import SettingsGroup from '@/pages/settings/components/SettingsGroup.vue'
import SettingsRow from '@/pages/settings/components/SettingsRow.vue'
import { useAlertChannel } from '@/pages/settings/composables/useAlertChannel.ts'
import { useAlertSettings } from '@/pages/settings/composables/useAlertSettings.ts'
import type { AlertReadiness } from '@/pages/settings/utils/alertReadiness.ts'

import { ALERT_CONTENTS, ALERT_EVENTS } from '@/shared/api/alertsApi.ts'
import type { AlertEvent } from '@/shared/api/alertsApi.ts'
import type { ChoiceOption } from '@/shared/ui/choiceControls.ts'
import FieldError from '@/shared/ui/FieldError.vue'
import PlatformStatePanel from '@/shared/ui/PlatformStatePanel.vue'
import SelectionControl from '@/shared/ui/SelectionControl.vue'
import SemanticState from '@/shared/ui/SemanticState.vue'
import ToggleSwitch from '@/shared/ui/ToggleSwitch.vue'
import { vTooltip } from '@/shared/ui/tooltipAnchors.ts'
import VButton from '@/shared/ui/VButton.vue'
import VIcon from '@/shared/ui/VIcon.vue'

const props = defineProps<{ locale: string }>()
const { t } = useI18n()
const { settings, panelState, load, update, failureOf } = useAlertSettings(() => props.locale)
const { readiness, checking, sending, testOutcome, recheck, sendTest } = useAlertChannel()

const EVENTS_LABEL_ID = 'settings-alerts-events-label'

const contentOptions = computed<ChoiceOption[]>(() =>
  ALERT_CONTENTS.map((value) => ({ value, label: t(`alerts.content.${value}`) })),
)
const contentHint = computed(() =>
  settings.value?.content === 'prompt'
    ? `${t('alerts.contentHint')} ${t('alerts.contentPromptHint')}`
    : t('alerts.contentHint'),
)

const readinessState = computed(() => readiness.value?.state ?? 'not-observed')
const readinessText = computed(() =>
  readiness.value ? readinessLabel(readiness.value) : t('alerts.checking'),
)
const readinessNote = computed(() => (readiness.value ? readinessDetail(readiness.value) : ''))
const recheckLabel = computed(() => (checking.value ? t('alerts.checking') : t('alerts.recheck')))
const testLabel = computed(() => (sending.value ? t('alerts.testSending') : t('alerts.test')))
const testRefusal = computed(() =>
  testOutcome.value === null || testOutcome.value.code === 'ready'
    ? ''
    : `${readinessLabel(testOutcome.value)}: ${readinessDetail(testOutcome.value)}`,
)
/** Waiting keeps focus on the button, so it is `aria-disabled`, and absent rather than false. */
const checkingMark = computed(() => checking.value || undefined)
const sendingMark = computed(() => sending.value || undefined)

/** The master switch clears every box on screen and keeps what was chosen underneath. */
function eventChecked(event: AlertEvent): boolean {
  return settings.value !== null && settings.value.enabled && settings.value.events[event]
}

function setEvent(event: AlertEvent, on: boolean) {
  if (settings.value === null) return
  update('events', { events: { ...settings.value.events, [event]: on } })
}

function selectContent(value: string) {
  const content = ALERT_CONTENTS.find((known) => known === value)
  if (content !== undefined) update('content', { content })
}

function readinessLabel(answer: AlertReadiness): string {
  return t(`alerts.readiness.${answer.code}.label`)
}

/** A failed check has only the server's words to give; the rest have the product's cure. */
function readinessDetail(answer: AlertReadiness): string {
  if (answer.code === 'ready') return ''
  if (answer.code === 'failed' || answer.code === 'unavailable')
    return answer.reason ?? t('alerts.readiness.failed.detail')
  return t(`alerts.readiness.${answer.code}.detail`)
}
</script>

<template>
  <SettingsGroup
    :title="t('alerts.title')"
    :intro="t('alerts.intro')"
  >
    <template
      v-if="failureOf('locale')"
      #note
    >
      <FieldError
        class="settings-alerts-failure"
        role="alert"
        >{{ failureOf('locale') }}</FieldError
      >
    </template>
    <!-- In place of the rows, the panel lies inside the group as a thing of its own: flush
         under the head it took the head's tone and ran into it, and its round corners
         stood out of the group's edge. -->
    <div
      v-if="!settings"
      class="settings-alerts-panel"
    >
      <PlatformStatePanel
        :state="panelState"
        compact
        @retry="load"
      />
    </div>
    <template v-else>
      <SettingsRow
        :label="t('alerts.enabled')"
        :hint="t('alerts.enabledHint')"
        :failure="failureOf('enabled')"
      >
        <ToggleSwitch
          class="settings-alerts-control settings-alerts-switch"
          :model-value="settings.enabled"
          :label="t('alerts.enabled')"
          :on-label="t('alerts.on')"
          :off-label="t('alerts.off')"
          @update:model-value="update('enabled', { enabled: $event })"
        />
      </SettingsRow>

      <SettingsRow
        :label="t('alerts.events')"
        :hint="t('alerts.eventsHint')"
        :label-id="EVENTS_LABEL_ID"
        :failure="failureOf('events')"
        stack
      >
        <div
          class="settings-alerts-control settings-alerts-events"
          role="group"
          :aria-labelledby="EVENTS_LABEL_ID"
        >
          <label
            v-for="event in ALERT_EVENTS"
            :key="event"
            class="settings-alerts-event"
            :class="{ muted: !settings.enabled }"
          >
            <input
              class="settings-alerts-box"
              type="checkbox"
              :checked="eventChecked(event)"
              :disabled="!settings.enabled"
              @change="setEvent(event, ($event.target as HTMLInputElement).checked)"
            />
            {{ t(`alerts.event.${event}`) }}
          </label>
        </div>
      </SettingsRow>

      <SettingsRow
        :label="t('alerts.contentLabel')"
        :hint="contentHint"
        :failure="failureOf('content')"
      >
        <SelectionControl
          class="settings-alerts-control"
          mode="combobox"
          :model-value="settings.content"
          :options="contentOptions"
          :label="t('alerts.contentLabel')"
          @update:model-value="selectContent"
        />
      </SettingsRow>

      <SettingsRow
        :label="t('alerts.readinessLabel')"
        stack
      >
        <div class="settings-alerts-control settings-alerts-line">
          <div
            class="settings-alerts-readiness"
            role="status"
          >
            <SemanticState
              class="settings-alerts-state"
              dimension="integration-health"
              :state="readinessState"
              :label="readinessText"
            />
            <span
              v-if="readinessNote"
              class="settings-alerts-detail"
              >{{ readinessNote }}</span
            >
          </div>
          <VButton
            v-if="readiness"
            v-tooltip="recheckLabel"
            class="settings-alerts-recheck"
            size="compact"
            variant="ghost"
            :aria-label="recheckLabel"
            :aria-disabled="checkingMark"
            icon
            @click="recheck"
          >
            <VIcon name="refresh" />
          </VButton>
        </div>
      </SettingsRow>

      <SettingsRow
        :label="t('alerts.testLabel')"
        :hint="t('alerts.testHint')"
      >
        <VButton
          class="settings-alerts-control settings-alerts-test"
          :aria-disabled="sendingMark"
          :aria-busy="sendingMark"
          @click="sendTest"
          >{{ testLabel }}</VButton
        >
        <span
          v-if="testOutcome?.code === 'ready'"
          class="settings-alerts-detail"
          role="status"
          >{{ t('alerts.testSent') }}</span
        >
        <FieldError
          v-else-if="testRefusal"
          class="settings-alerts-failure"
          role="alert"
          >{{ testRefusal }}</FieldError
        >
      </SettingsRow>
    </template>
  </SettingsGroup>
</template>

<style scoped>
/* The rows' own inset, so the panel stands on the group's ground with air on every side,
   and a read under way puts its dots where the rows' labels will start. */
.settings-alerts-panel {
  padding: var(--space-4);
}

.settings-alerts-control {
  width: 100%;
  min-width: 0;
}

/* Only as wide as what they say: a press beside a switch or a button's words is not on it. */
.settings-alerts-switch,
.settings-alerts-test {
  justify-self: start;
  width: auto;
}

.settings-alerts-events {
  display: grid;
}

/* The whole line takes the press, and the box stands on its first line however it wraps. */
.settings-alerts-event {
  display: flex;
  gap: var(--space-2);
  align-items: flex-start;
  min-height: var(--size-control-height-compact);
  padding-block: var(--space-2);
  font: var(--font-note);
  cursor: pointer;

  &.muted {
    color: var(--color-text-muted);
    cursor: default;
  }
}

.settings-alerts-box {
  flex: none;
  inline-size: var(--font-size-interface);
  block-size: var(--font-size-interface);
  margin: 0;
  font: inherit;
  translate: 0 calc((1lh - var(--font-size-interface)) / 2);
}

/* The state and its way to ask again share a line where there is room for both. */
.settings-alerts-line {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-3);
  align-items: center;
}

.settings-alerts-readiness {
  display: grid;
  gap: var(--space-label-value);
  min-width: 0;
}

/* The words wrap: at a phone's width the longest would run off the sheet. */
.settings-alerts-state {
  min-width: 0;
  white-space: normal;
}

.settings-alerts-detail {
  color: var(--color-text-muted);
  font: var(--font-detail);
  overflow-wrap: anywhere;
}
</style>
