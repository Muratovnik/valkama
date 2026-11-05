<script setup lang="ts">
/**
 * Who stands on this item: each agent, what it was started for, the step it holds,
 * what the record shows of its time, and how it is known to be here.
 *
 * Valkama observes agents and does not run them, so a row says what was recorded
 * and nothing about what is happening. It never says «working»: a session row
 * does not prove a process is alive, and an agent cut off by a restart leaves no
 * end. It gives the last sign of activity, and «ended» only with a recorded end.
 *
 * The link is read out to the reader rather than resolved for them: a coordinator
 * holding several items puts its agent on every one of them, and the row says so.
 *
 * This is what the card's Agents tab shows. The tab names and counts them, so this has no
 * heading of its own, and every row stands at once, newest first: a parent can leave dozens on
 * one item, and they are what the tab is opened for. The rows stand under the parent session they all open, whose way
 * back stands once at their head: in each row it was the same button down the whole list. Two
 * parents' heads can read alike, so where there are two each says which session it is.
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { agentFacts, agentsByParent } from '@/widgets/work-item-inspector/utils/agentFacts.ts'
import type { TimeWords } from '@/widgets/work-item-inspector/utils/agentFacts.ts'

import OpenAction from '@/features/session-open/OpenAction.vue'

import type { WorkItemAgent } from '@/shared/api/planningModel.ts'
import { spanWordsOf } from '@/shared/lib/timeSpan.ts'
import RichText from '@/shared/ui/RichText.vue'

const props = defineProps<{ agents: readonly WorkItemAgent[] }>()

const { t, d } = useI18n()

/**
 * What «3 minutes ago» is measured from. It moves on its own only while a row
 * without an end says how long ago something was; it fetches nothing.
 */
const now = ref(Date.now())
let clock: ReturnType<typeof setInterval> | undefined
function stopClock() {
  if (clock !== undefined) clearInterval(clock)
  clock = undefined
}
watch(
  () => props.agents.some((agent) => agent.ended_at === null),
  (open) => {
    stopClock()
    if (open) clock = setInterval(() => (now.value = Date.now()), 30_000)
  },
  { immediate: true },
)
onBeforeUnmount(stopClock)
// A live read can bring a row whose activity is newer than the last tick.
watch(
  () => props.agents,
  () => {
    now.value = Date.now()
  },
)

const words = computed<TimeWords>(() => ({
  ...spanWordsOf(t),
  clock: (date) => d(date, 'clock'),
  day: (date) => d(date, 'day'),
  year: (date) => d(date, 'activity'),
}))

function linkWords(agent: WorkItemAgent): string {
  if (agent.link === 'exact') return t('workItem.agents.linkExact')
  const held = agent.coordinator_items ?? 1
  return held > 1
    ? t('workItem.agents.linkAmbiguous', { count: held }, held)
    : t('workItem.agents.linkClaim')
}

const groups = computed(() =>
  agentsByParent(props.agents).map((group) => ({
    ...group,
    rows: group.agents.map((agent) => ({
      agent,
      facts: agentFacts(agent, now.value, words.value),
      link: linkWords(agent),
    })),
  })),
)
</script>

<template>
  <div class="agents">
    <div
      v-for="group in groups"
      :key="group.session"
      class="agent-group"
    >
      <div
        v-if="group.executor?.session"
        class="agent-group-head"
      >
        <OpenAction
          :session="group.executor.session"
          :executor="group.executor"
          :action="t('open.action.parent')"
          :detail="t('open.hint.parent')"
        />
        <span
          v-if="groups.length > 1"
          class="agent-group-id agent-id"
          :title="group.session"
          >{{ group.shortSession }}</span
        >
      </div>
      <ul class="agent-list">
        <li
          v-for="{ agent, facts, link } in group.rows"
          :key="`${agent.session_id}:${agent.agent_id}`"
          class="agent"
        >
          <RichText
            v-if="agent.label"
            class="agent-name"
            :source="agent.label"
            inline
          />
          <span
            v-else
            class="agent-name"
            :class="{ 'agent-id': !agent.agent_type }"
            >{{ agent.agent_type || facts.shortId }}</span
          >
          <p
            v-for="step in agent.steps"
            :key="step.id"
            class="agent-step"
          >
            {{ t('workItem.agents.holdsStep') }}
            <RichText
              :source="step.text"
              inline
            />
          </p>
          <p class="agent-times">
            <span class="agent-fact">
              {{ t('workItem.agents.started') }}
              <time
                :datetime="facts.started.at"
                :title="facts.started.full"
                >{{ facts.started.text }}</time
              ><template v-if="facts.quiet">, {{ facts.quiet }}</template>
            </span>
            <span
              v-if="facts.ended"
              class="agent-fact"
            >
              {{ t('workItem.agents.ended') }}
              <time
                :datetime="facts.ended.at"
                :title="facts.ended.full"
                >{{ facts.ended.text }}</time
              >
            </span>
            <span
              v-else-if="facts.activity"
              class="agent-fact"
            >
              {{ t('workItem.agents.lastActivity') }}
              <time
                :datetime="facts.activity.at"
                :title="facts.activity.full"
                >{{ facts.activity.text }}</time
              >, {{ facts.ago }}
            </span>
            <span
              v-else
              class="agent-fact"
              >{{ t('workItem.agents.noSignal') }}</span
            >
            <span
              v-if="facts.elapsed"
              class="agent-fact"
              >{{ t('workItem.agents.fromStart', { time: facts.elapsed }) }}</span
            >
          </p>
          <p class="agent-source">
            <span
              v-if="agent.label && agent.agent_type"
              class="agent-fact"
              >{{ agent.agent_type }}</span
            >
            <span
              v-if="agent.label || agent.agent_type"
              class="agent-fact"
              ><span
                class="agent-id"
                :title="agent.agent_id"
                >{{ facts.shortId }}</span
              ></span
            >
            <span class="agent-fact">{{ link }}</span>
          </p>
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.agents {
  display: grid;
  gap: var(--space-8);
}

.agent-group {
  display: grid;
  gap: var(--space-heading-content);
  min-width: 0;
}

.agent-group-head {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1) var(--space-2);
  align-items: center;
  min-width: 0;
}

.agent-group-id {
  color: var(--color-text-tertiary);
  font-size: var(--font-size-dense);
}

.agent-list {
  display: grid;
  gap: var(--space-4);
  padding: 0;
  margin: 0;
  list-style: none;
}

/* Air between rows and none inside: a row reads as one record, and a line between
   them would be one more divider on a card that holds few. */
.agent {
  display: grid;
  gap: var(--space-1);
  min-width: 0;
}

.agent-name {
  color: var(--color-text);
  font: var(--font-field-label);
  overflow-wrap: anywhere;
}

.agent-step {
  margin: 0;
  color: var(--color-text);
  font: var(--font-detail);
  overflow-wrap: anywhere;
}

.agent-times {
  display: flex;
  flex-wrap: wrap;
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-detail);
  overflow: clip;
}

.agent-source {
  display: flex;
  flex-wrap: wrap;
  margin: 0;
  color: var(--color-text-tertiary);
  font: var(--font-detail);
  overflow: clip;
}

/* The dot stands in each fact's own padding, in the room its negative margin takes
   from the line. A fact that starts a line has that room outside the box, where
   `overflow: clip` on the line takes the dot away, so a wrapped line never starts
   with one and an absent fact leaves none behind. */
.agent-fact {
  position: relative;
  min-width: 0;
  padding-inline-start: var(--space-4);
  margin-inline: calc(-1 * var(--space-4)) var(--space-4);
  overflow-wrap: anywhere;

  &::before {
    content: '·' / '';
    position: absolute;
    inset-inline-start: 0;
    width: var(--space-4);
    text-align: center;
  }
}

.agent-id {
  font-family: var(--font-family-mono);
}
</style>
