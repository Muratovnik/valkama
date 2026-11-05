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
 * holding several items puts its agent on every one of them, and the group says so once,
 * under its head, as one count or the range of its rows' counts. The row keeps its own exact
 * count in its tooltip and its accessible description.
 *
 * This is what the card's Agents tab shows. The tab names and counts them, so this has no
 * heading of its own, and every row stands at once, newest first: a parent can leave dozens on
 * one item, and they are what the tab is opened for. The rows stand under the parent session they all open, whose way
 * back stands once at their head: in each row it was the same button down the whole list. Two
 * parents' heads can read alike, so where there are two each says which session it is.
 *
 * It is also where a card says how much work the item took. The whole of it stands at the head,
 * the session's under the session's way back, and each agent's beside its name, in columns the
 * group shares so that they compare down the list. Those who spent something on the item come
 * first, whether the record names them or not: the session's own run, which no row of the record
 * is, and on an epic the epic's own runs, while its children's time stands in the chain.
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import AgentSessionUsage from '@/widgets/work-item-inspector/components/AgentSessionUsage.vue'
import AgentsUsageSummary from '@/widgets/work-item-inspector/components/AgentsUsageSummary.vue'
import UsageFacts from '@/widgets/work-item-inspector/components/UsageFacts.vue'
import { agentFacts } from '@/widgets/work-item-inspector/utils/agentFacts.ts'
import type { TimeWords } from '@/widgets/work-item-inspector/utils/agentFacts.ts'
import { agentRowGroups } from '@/widgets/work-item-inspector/utils/agentUsage.ts'
import { injectInspectorUsage } from '@/widgets/work-item-inspector/utils/useInspectorRecord.ts'
import { useSessionUsage } from '@/widgets/work-item-inspector/utils/useSessionUsage.ts'
import { isEstimated, useUsageWords } from '@/widgets/work-item-inspector/utils/useUsageWords.ts'

import OpenAction from '@/features/session-open/OpenAction.vue'

import type { WorkItemAgent } from '@/shared/api/planningModel.ts'
import { spanWordsOf } from '@/shared/lib/timeSpan.ts'
import RichText from '@/shared/ui/RichText.vue'

const props = defineProps<{ agents: readonly WorkItemAgent[] }>()

const { t, d } = useI18n()
const inspector = injectInspectorUsage()
const usage = inspector?.read
const { figures } = useUsageWords()

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

/** Whether the coordinator behind this agent's link holds more items than this one. */
function isAmbiguous(agent: WorkItemAgent): boolean {
  return agent.link !== 'exact' && (agent.coordinator_items ?? 1) > 1
}

function linkWords(agent: WorkItemAgent): string {
  if (agent.link === 'exact') return t('workItem.agents.linkExact')
  const held = agent.coordinator_items ?? 1
  return isAmbiguous(agent)
    ? t('workItem.agents.linkAmbiguous', { count: held }, held)
    : t('workItem.agents.linkClaim')
}

/**
 * The one line a group says about its ambiguous links: its count when they agree, else the
 * range of them, declined by the upper bound. Empty when no row of the group is ambiguous.
 */
function groupAmbiguity(agents: readonly WorkItemAgent[]): string {
  const counts = agents
    .filter((agent) => isAmbiguous(agent))
    .map((agent) => agent.coordinator_items ?? 1)
  if (counts.length === 0) return ''
  const from = Math.min(...counts)
  const to = Math.max(...counts)
  return from === to
    ? t('workItem.agents.linkAmbiguous', { count: to }, to)
    : t('workItem.agents.linkAmbiguousRange', { from, to }, to)
}

/** The runs the rows name: an epic's own, which the whole read of an epic would widen. */
const spent = computed(() => inspector?.rows.value ?? null)
const estimated = computed(() => Boolean(spent.value && isEstimated(spent.value)))

const groups = computed(() =>
  agentRowGroups(props.agents, spent.value?.agents ?? []).map((group) => ({
    ...group,
    ambiguity: groupAmbiguity(group.agents),
    spends: group.rows.some((row) => row.spent),
    rows: group.rows.map(({ agent, key, spent: run }) => ({
      key,
      agent,
      /** The run's short id, where the record names no agent to call it by. */
      runId: run?.agent_id?.slice(0, 8) ?? '',
      figures: run ? figures({ ...run }, estimated.value) : [],
      ...(agent
        ? {
            ambiguous: isAmbiguous(agent),
            facts: agentFacts(agent, now.value, words.value),
            link: linkWords(agent),
            /** The exact count of an ambiguous row, which the group's line does not repeat. */
            hint: isAmbiguous(agent) ? linkWords(agent) : undefined,
          }
        : { ambiguous: false, facts: null, link: '', hint: undefined }),
    })),
  })),
)

const sessions = useSessionUsage(
  () => (usage ? groups.value.map((group) => group.usageSession) : []),
  () => usage?.version.value ?? 0,
)

type Group = (typeof groups.value)[number]
/** What the group's session took as a whole, once its read has answered. */
const sessionOf = (group: Group) => sessions.answers.value.get(group.usageSession) ?? null
const sessionWaits = (group: Group) => sessions.waiting.value.has(group.usageSession)
/** Figures stand in the group's columns where any of its rows, or its session, has some. */
const hasUsage = (group: Group) => group.spends || sessionOf(group) !== null
</script>

<template>
  <div class="agents">
    <AgentsUsageSummary />
    <div
      v-for="group in groups"
      :key="group.session"
      class="agent-group"
      :class="{ 'has-usage': hasUsage(group) }"
    >
      <div
        v-if="group.executor?.session || groups.length > 1"
        class="agent-group-head"
      >
        <OpenAction
          v-if="group.executor?.session"
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
      <AgentSessionUsage
        :session="sessionOf(group)"
        :waiting="sessionWaits(group)"
      />
      <p
        v-if="group.ambiguity"
        class="agent-group-link"
      >
        {{ group.ambiguity }}
      </p>
      <ul class="agent-list">
        <li
          v-for="{
            agent,
            ambiguous,
            facts,
            figures: spentFigures,
            hint,
            key,
            link,
            runId,
          } in group.rows"
          :key="key"
          class="agent"
          :title="hint"
          :aria-description="hint"
        >
          <RichText
            v-if="agent?.label"
            class="agent-name"
            :source="agent.label"
            inline
          />
          <span
            v-else-if="agent"
            class="agent-name"
            :class="{ 'agent-id': !agent.agent_type }"
            >{{ agent.agent_type || facts?.shortId }}</span
          >
          <span
            v-else
            class="agent-name"
            :class="{ 'agent-id': runId }"
            >{{ runId || t('workItem.usage.ownRun') }}</span
          >
          <UsageFacts
            v-if="spentFigures.length"
            class="agent-spent"
            :facts="spentFigures"
            columns
          />
          <template v-if="agent && facts">
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
              <span
                v-if="!ambiguous"
                class="agent-fact"
                >{{ link }}</span
              >
            </p>
          </template>
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

/* Where the group's figures stand in columns they are the grid's, so that they compare down the
   list; everything else in the group takes the whole width. */
.agent-group {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--space-heading-content);
  min-width: 0;

  &.has-usage {
    grid-template-columns: minmax(0, 1fr) repeat(3, auto);
    column-gap: var(--space-3);
  }

  > * {
    grid-column: 1 / -1;
  }
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

/* One line for the group's ambiguous rows, in the quiet ink the rows' facts use. */
.agent-group-link {
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-detail);
  overflow-wrap: anywhere;
}

.agent-list {
  display: grid;
  grid-template-columns: subgrid;
  row-gap: var(--space-4);
  padding: 0;
  margin: 0;
  list-style: none;
}

/* Air between rows and none inside: a row reads as one record, and a line between
   them would be one more divider on a card that holds few. */
.agent {
  display: grid;
  grid-template-columns: subgrid;
  grid-column: 1 / -1;
  row-gap: var(--space-1);
  align-items: baseline;
  min-width: 0;

  > * {
    grid-column: 1 / -1;
  }
}

.agent-name {
  color: var(--color-text);
  font: var(--font-field-label);
  overflow-wrap: anywhere;
}

/* What it spent, in the quiet ink of the row's facts. */
.agent-spent {
  color: var(--color-text-muted);
  font: var(--font-detail);
}

@container drawer (width >= 560px) {
  .agent-name:has(+ .agent-spent) {
    grid-column: 1;
  }

  .agent-spent {
    grid-column: 2 / -1;
  }
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
