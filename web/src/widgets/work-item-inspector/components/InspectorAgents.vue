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
 * A disclosure as the chain's lists are: the most recent first, the rest behind a
 * toggle that puts focus on the first row it revealed and takes it back on closing.
 */
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { agentFacts, AGENTS_SHOWN } from '@/widgets/work-item-inspector/utils/agentFacts.ts'
import type { TimeWords } from '@/widgets/work-item-inspector/utils/agentFacts.ts'

import type { WorkItemAgent } from '@/shared/api/planningModel.ts'
import RichText from '@/shared/ui/RichText.vue'
import SectionHeader from '@/shared/ui/SectionHeader.vue'
import VButton from '@/shared/ui/VButton.vue'

const props = defineProps<{
  agents: readonly WorkItemAgent[]
  /** The item's id: another item's card starts folded. */
  identity: string
}>()

const { t, d } = useI18n()

const expanded = ref(false)
watch(
  () => props.identity,
  () => {
    expanded.value = false
  },
)
/** One row behind a toggle saves nothing and costs a press: it stands with the rest. */
const long = computed(() => props.agents.length > AGENTS_SHOWN + 1)
const shown = computed(() =>
  expanded.value || !long.value ? props.agents : props.agents.slice(0, AGENTS_SHOWN),
)

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
  clock: (date) => d(date, 'clock'),
  day: (date) => d(date, 'day'),
  year: (date) => d(date, 'activity'),
  lessThanMinute: t('workItem.agents.lessThanMinute'),
  minutes: (count) => t('workItem.agents.minutes', { count }),
  hours: (count) => t('workItem.agents.hours', { count }),
  days: (count) => t('workItem.agents.days', { count }),
  ago: (time) => t('workItem.agents.ago', { time }),
  justNow: t('workItem.agents.justNow'),
}))

function linkWords(agent: WorkItemAgent): string {
  if (agent.link === 'exact') return t('workItem.agents.linkExact')
  const held = agent.coordinator_items ?? 1
  return held > 1
    ? t('workItem.agents.linkAmbiguous', { count: held }, held)
    : t('workItem.agents.linkClaim')
}

const rows = computed(() =>
  shown.value.map((agent) => ({
    agent,
    facts: agentFacts(agent, now.value, words.value),
    link: linkWords(agent),
  })),
)

const toggleLabel = computed(() =>
  expanded.value
    ? t('workItem.agents.showFewer')
    : t('workItem.agents.showAll', { count: props.agents.length }),
)

const listId = useId()
const list = ref<HTMLElement | null>(null)
const toggler = ref<InstanceType<typeof VButton> | null>(null)

async function toggle() {
  const opening = !expanded.value
  expanded.value = opening
  await nextTick()
  if (opening) list.value?.querySelectorAll<HTMLElement>('.agent')[AGENTS_SHOWN]?.focus()
  else (toggler.value?.$el as HTMLElement | undefined)?.focus()
}
</script>

<template>
  <section class="agents">
    <SectionHeader
      :title="t('workItem.agents.heading')"
      :count="agents.length"
    />
    <ul
      :id="listId"
      ref="list"
      class="agent-list"
    >
      <li
        v-for="{ agent, facts, link } in rows"
        :key="`${agent.session_id}:${agent.agent_id}`"
        class="agent"
        tabindex="-1"
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
    <VButton
      v-if="long"
      ref="toggler"
      class="agents-more"
      variant="ghost"
      size="inline"
      :aria-controls="listId"
      :aria-expanded="expanded"
      @click="toggle"
    >
      {{ toggleLabel }}
    </VButton>
  </section>
</template>

<style scoped>
.agents {
  display: grid;
  gap: var(--space-heading-content);
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

  &:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: var(--space-1);
  }
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
    content: '·';
    position: absolute;
    inset-inline-start: 0;
    width: var(--space-4);
    text-align: center;
  }
}

.agent-id {
  font-family: var(--font-family-mono);
}

.agents-more {
  justify-self: start;
}
</style>
