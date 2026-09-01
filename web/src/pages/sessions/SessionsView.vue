<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import SessionTable from '@/pages/sessions/SessionTable.vue'

import SessionDetailDrawer from '@/widgets/session-detail/SessionDetailDrawer.vue'

import {
  filteredSessionGroups,
  groupSessions,
  monitorTotals,
  sessionAt,
  sortSessions,
} from '@/entities/session/sessionDerivations.ts'

import type { PlatformUiState } from '@/shared/api/platformUiState.ts'
import type { SessionWorkItemNavigationTarget } from '@/shared/types/reference.ts'
import type { AgentSession, SessionsPayload } from '@/shared/types/session.ts'
import CountBadge from '@/shared/ui/CountBadge.vue'
import InfoTip from '@/shared/ui/InfoTip.vue'
import PlatformStatePanel from '@/shared/ui/PlatformStatePanel.vue'
import SegmentedControl from '@/shared/ui/SegmentedControl.vue'
import VButton from '@/shared/ui/VButton.vue'

const props = defineProps<{
  revisions: Readonly<Record<string, string>>
  selected: string | null
  state: PlatformUiState<SessionsPayload>
}>()
const emit = defineEmits<{
  'attached': [reference: string]
  'open-work-item': [target: SessionWorkItemNavigationTarget]
  'retry': []
  'select': [session: AgentSession | null]
}>()
const { t } = useI18n()

const activeGroup = ref<'all' | 'attention' | 'working' | 'waiting' | 'recent'>('all')
const now = ref(Date.now())
const clock = setInterval(() => (now.value = Date.now()), 30_000)

const snapshot = computed(() => ('payload' in props.state ? props.state.payload.sessions : []))
const rows = computed(() =>
  sortSessions(snapshot.value.map((session) => sessionAt(session, now.value))),
)
const totals = computed(() => monitorTotals(rows.value))
const groups = computed(() => groupSessions(rows.value))
const retryable = computed(() => props.state.status === 'error')

const visibleGroups = computed(() =>
  filteredSessionGroups(groups.value, activeGroup.value).map((group) => ({
    ...group,
    label: t(`monitor.groups.${group.key}`),
  })),
)

const statGroups = computed(() => [
  { key: 'attention' as const, label: t('monitor.needsAttention'), value: totals.value.attention },
  { key: 'working' as const, label: t('monitor.working'), value: totals.value.working },
  { key: 'waiting' as const, label: t('monitor.attention.waiting'), value: totals.value.waiting },
  { key: 'recent' as const, label: t('monitor.status.ended'), value: totals.value.recent },
])

/** The count belongs in the label, so the filter row is text and not a scoreboard. */
const groupSegments = computed(() => [
  { value: 'all' as const, label: t('monitor.groups.all') },
  ...statGroups.value.map((stat) => ({
    value: stat.key,
    label: `${stat.label} · ${stat.value}`,
  })),
])

onUnmounted(() => clearInterval(clock))

/**
 * Which session is open is a route fact, not a page fact.
 *
 * The same reasoning as the work item drawer: a selection kept in the component
 * cannot be linked to, does not survive a reload, and cannot be reached from
 * another module — which is exactly what opening a session from its work item
 * has to do.
 */
const selectedSnapshot = ref<AgentSession | null>(null)
watch(
  [rows, () => props.selected],
  ([sessions, selected], [, previousSelected]) => {
    if (selected === null) {
      selectedSnapshot.value = null
      return
    }
    if (selected !== previousSelected) selectedSnapshot.value = null
    const match = sessions.find((session) => session.id === selected)
    if (match !== undefined) selectedSnapshot.value = match
  },
  { immediate: true },
)
const selectedSession = computed(() => selectedSnapshot.value)
const selectedMissing = computed(
  () =>
    props.selected !== null &&
    !rows.value.some((session) => session.id === props.selected) &&
    (props.state.status === 'ready' || props.state.status === 'empty'),
)
const selectedRevision = computed(() =>
  props.selected === null ? '' : (props.revisions[props.selected] ?? ''),
)

/** The drawer already refuses to offer this without both halves. */
function openWorkItemFromSession(target: SessionWorkItemNavigationTarget) {
  emit('select', null)
  emit('open-work-item', target)
}
</script>

<template>
  <section
    class="monitor"
    :aria-label="t('monitor.title')"
  >
    <!-- The context bar already names the module; a second title here was the
         same word twice with nothing between them. What the head owns is the
         filter and the one fact the ledger cannot show: what history keeps. -->
    <header class="monitor-head">
      <SegmentedControl
        v-model="activeGroup"
        :options="groupSegments"
        :label="t('monitor.title')"
      />
      <InfoTip :label="t('monitor.retentionHelp')">{{ t('monitor.retention') }}</InfoTip>
    </header>

    <div class="monitor-workspace">
      <div class="monitor-content">
        <div
          v-if="!('payload' in state)"
          class="monitor-state"
        >
          <PlatformStatePanel
            :state="state"
            :retryable="retryable"
            @retry="emit('retry')"
          />
        </div>
        <PlatformStatePanel
          v-else
          :state="state"
          :retryable="false"
        >
          <div class="session-ledger">
            <div
              v-if="state.status === 'degraded' && state.reason"
              class="monitor-recovery"
            >
              <VButton @click="emit('retry')">{{ t('platform.actions.retry') }}</VButton>
            </div>
            <div class="session-groups">
              <section
                v-for="group in visibleGroups"
                :key="group.key"
                class="session-group"
              >
                <div class="session-group-head">
                  <h3 class="session-group-title">{{ group.label }}</h3>
                  <CountBadge
                    placement="inline"
                    :value="group.sessions.length"
                    :label="`${group.label}: ${group.sessions.length}`"
                  />
                </div>
                <SessionTable
                  :sessions="group.sessions"
                  :selected-id="selected"
                  @select="(session) => emit('select', session)"
                />
              </section>
            </div>
          </div>
        </PlatformStatePanel>
      </div>

      <SessionDetailDrawer
        :session="selectedSession"
        :requested-id="selected"
        :missing="selectedMissing"
        :revision="selectedRevision"
        @close="emit('select', null)"
        @open-work-item="openWorkItemFromSession"
        @attached="(reference) => emit('attached', reference)"
      />
    </div>
  </section>
</template>

<style scoped>
.monitor {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 0;
  color: var(--color-text);
  background: var(--color-canvas);
}

.monitor-head {
  display: flex;
  flex: none;
  gap: var(--space-6);
  justify-content: space-between;
  align-items: center;
  padding: var(--space-3) var(--space-5);
  border-bottom: 1px solid var(--color-rule);
}

.monitor-workspace {
  position: relative;
  display: flex;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.monitor-state {
  flex: 1;
  align-self: flex-start;
  min-width: 0;
  padding: var(--space-4);
}

.monitor-content {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}

.monitor-recovery {
  display: flex;
  justify-content: flex-end;
  padding: var(--space-3) var(--space-4) 0;
}

/* The ledger is what the tables inside it measure against: it loses width to the
   detail inspector when that is open, and the window knows nothing about it. */
.session-ledger {
  flex: 1;
  min-width: 0;
  background: var(--color-canvas);
  overflow-y: auto;
  container-type: inline-size;
  container-name: session-ledger;
}

.session-groups {
  min-width: 0;
  padding: var(--space-5) var(--space-4) var(--space-8);
}

.session-group {
  min-width: 0;
  margin: 0 auto var(--space-5);
}

.session-group-head {
  display: flex;
  gap: var(--space-2);
  align-items: center;
  max-width: var(--size-module-column);
  padding: 0 0 var(--space-2);
  margin: 0 auto;
}

.session-group-title {
  margin: 0;
  color: var(--color-text);
  font: var(--font-label);
}

@container session-ledger (max-width:700px) {
  .session-groups {
    padding: var(--space-3) var(--space-2);
  }
}

@container workspace (width <= 696px) {
  .monitor-head {
    flex-direction: column;
    gap: var(--space-3);
    align-items: flex-start;
  }
}
</style>
