<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import SessionActions from '@/widgets/session-detail/SessionActions.vue'
import SessionFacts from '@/widgets/session-detail/SessionFacts.vue'
import SessionFeed from '@/widgets/session-detail/SessionFeed.vue'

import { displayName, sessionIdentity, sessionTone } from '@/entities/session/sessionDerivations.ts'

import { uiUnavailable } from '@/shared/api/platformUiState.ts'
import { sessionSemanticState } from '@/shared/api/sessionSemanticState.ts'
import type { SessionWorkItemNavigationTarget } from '@/shared/types/reference.ts'
import type { AgentSession } from '@/shared/types/session.ts'
import InspectorFrame from '@/shared/ui/InspectorFrame.vue'
import PlatformStatePanel from '@/shared/ui/PlatformStatePanel.vue'
import ResizableInspector from '@/shared/ui/ResizableInspector.vue'
import SemanticState from '@/shared/ui/SemanticState.vue'

const props = defineProps<{
  missing: boolean
  requestedId: string | null
  revision: string
  session: AgentSession | null
}>()
const emit = defineEmits<{
  'attached': [reference: string]
  'close': []
  'open-work-item': [target: SessionWorkItemNavigationTarget]
}>()
const { t, te } = useI18n()
const drawerTitle = computed(() =>
  props.session ? displayName(props.session) : (props.requestedId ?? t('monitor.sessionDetails')),
)
const drawerSubtitle = computed(() =>
  props.session ? sessionIdentity(props.session).reporter : '',
)

function attentionLabel(session: AgentSession): string {
  const key = `monitor.attention.${session.attention}`
  return te(key) ? t(key) : session.attention
}

/**
 * The one word at the top of the drawer.
 *
 * `sessionTone` answers a presentation question with five values; the heading
 * answers "what is happening" with four, because a stale claim and a live one are
 * the same activity seen at two ages and the drawer says which further down.
 */
function stateLabel(session: AgentSession): string {
  const state = sessionSemanticState(session)
  if (state === 'failed') return t('monitor.status.failed')
  if (state === 'attention') return attentionLabel(session)
  if (state === 'working') return t('monitor.groups.working')
  if (state === 'ended') return t('monitor.status.ended')
  return sessionTone(session) === 'stale'
    ? t('monitor.status.stale')
    : t('monitor.attention.waiting')
}
</script>

<template>
  <ResizableInspector
    :open="Boolean(session) || missing"
    :label="t('monitor.resizeDetails')"
    @close="emit('close')"
  >
    <template v-if="session || missing">
      <InspectorFrame
        :key="session?.id ?? requestedId ?? 'missing-session'"
        :title="drawerTitle"
        :subtitle="drawerSubtitle"
        :close-label="t('monitor.closeDetails')"
        @close="emit('close')"
      >
        <template #meta>
          <SemanticState
            v-if="session"
            class="session-summary"
            dimension="session"
            :state="sessionSemanticState(session)"
            :label="stateLabel(session)"
          />
        </template>

        <PlatformStatePanel
          v-if="missing"
          :state="uiUnavailable(t('monitor.selectedMissing'))"
          :retryable="false"
          compact
        />
        <template v-if="session">
          <SessionActions
            :session="session"
            @open-work-item="(target) => emit('open-work-item', target)"
            @attached="(reference) => emit('attached', reference)"
          />
          <SessionFacts :session="session" />
          <SessionFeed
            :session-id="session.id"
            :revision="props.revision"
          />
        </template>
      </InspectorFrame>
    </template>
  </ResizableInspector>
</template>

<style scoped>
.session-summary {
  margin: var(--space-2) 0 0;
}
</style>
