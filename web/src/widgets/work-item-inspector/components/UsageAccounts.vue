<script setup lang="ts">
/**
 * Under which organization an item's work ran: a strip of its stretches in the order the work was
 * done, each as long as its time, with a numbered mark where the organization changed; under it
 * each organization with its share of the time and what it spent, and the changes in words.
 *
 * The strip is drawn for the eye. The list and the changes say all it shows, the first stretch's
 * organization included, so no part of it is told by its hue alone. An organization the record
 * does not hold is drawn hatched in the neutral and named as unknown. An organization's id is
 * printed by its start, as an agent's is, and whole in its hint.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import UsageFacts from '@/widgets/work-item-inspector/components/UsageFacts.vue'
import { accountStrip } from '@/widgets/work-item-inspector/utils/accountStrip.ts'
import { agentIdStart } from '@/widgets/work-item-inspector/utils/agentFacts.ts'
import { useUsageWords } from '@/widgets/work-item-inspector/utils/useUsageWords.ts'

import type { ItemUsage } from '@/shared/api/planningUsageApi.ts'
import type { PlacedTick } from '@/shared/ui/chartGeometry.ts'
import ChartTicks from '@/shared/ui/ChartTicks.vue'
import { vTooltip } from '@/shared/ui/tooltipAnchors.ts'

type Account = ItemUsage['accounts'][number]['account']

const props = defineProps<{ estimated: boolean; usage: ItemUsage }>()

const { t, d, locale } = useI18n()
const { figures } = useUsageWords()

const strip = computed(() =>
  accountStrip(
    props.usage.account_stretches,
    props.usage.accounts.map((line) => line.account),
  ),
)

/** What the card calls an organization: the start of its id, or that it is unknown. */
const nameOf = (account: Account) =>
  account.unknown || account.id === null
    ? t('workItem.usage.accountUnknown')
    : agentIdStart(account.id)
/** The whole id, where the name is only its start. */
const fullOf = (account: Account) =>
  account.id === null || agentIdStart(account.id) === account.id ? undefined : account.id

function share(value: number) {
  return new Intl.NumberFormat(locale.value, {
    style: 'percent',
    maximumFractionDigits: value > 0 && value < 0.01 ? 1 : 0,
  }).format(value)
}

const rows = computed(() =>
  props.usage.accounts.map((line, index) => ({
    key: `${index}:${line.account.id ?? ''}`,
    name: nameOf(line.account),
    full: fullOf(line.account),
    unknown: line.account.unknown,
    slot: strip.value.slotOf(line.account),
    share: t('workItem.usage.accountShare', { share: share(line.share) }),
    facts: figures(line, props.estimated),
  })),
)

/**
 * The strip in words: the organization it starts under, then each change, numbered as over the
 * strip, with when it happened. Nothing to say where it never changed.
 */
const notes = computed(() => {
  const { parts, changes } = strip.value
  if (!changes.length) return []
  return [
    {
      key: 'start',
      number: '',
      at: '',
      when: t('workItem.usage.accountStart'),
      name: nameOf(parts[0].account),
      id: !parts[0].account.unknown,
    },
    ...changes.map((change) => ({
      key: String(change.number),
      number: String(change.number),
      at: change.at,
      when: d(new Date(change.at), 'day'),
      name: nameOf(change.account),
      id: !change.account.unknown,
    })),
  ]
})

function edgeOf(offset: number): PlacedTick['edge'] {
  if (offset < 0.05) return 'start'
  return offset > 0.95 ? 'end' : 'middle'
}

/** The changes' numbers over the strip; the first and the last keep inside its edges. */
const marks = computed<PlacedTick[]>(() =>
  strip.value.changes.map((change) => ({
    key: change.number,
    text: String(change.number),
    offset: change.start,
    edge: edgeOf(change.start),
  })),
)

const percent = (part: number) => `${part * 100}%`
</script>

<template>
  <div class="usage-accounts">
    <div
      class="account-plot"
      aria-hidden="true"
    >
      <ChartTicks
        v-if="marks.length"
        class="account-marks"
        along="inline"
        :ticks="marks"
      />
      <div class="account-strip">
        <span
          v-for="part in strip.parts"
          :key="part.key"
          class="account-part series-fill"
          :class="{ 'is-unknown': part.account.unknown }"
          :data-slot="part.slot"
          :style="{ insetInlineStart: percent(part.start), inlineSize: percent(part.size) }"
        />
        <span
          v-for="change in strip.changes"
          :key="change.number"
          class="account-mark"
          :style="{ insetInlineStart: percent(change.start) }"
        />
      </div>
    </div>
    <ul
      class="account-list"
      :aria-label="t('workItem.usage.accounts')"
    >
      <li
        v-for="row in rows"
        :key="row.key"
        class="account-row"
      >
        <span
          aria-hidden="true"
          class="account-swatch series-fill"
          :class="{ 'is-unknown': row.unknown }"
          :data-slot="row.slot"
        />
        <span
          v-tooltip.detail="row.full"
          class="account-name"
          :class="{ 'account-id': !row.unknown }"
          >{{ row.name }}</span
        >
        <span class="account-share">{{ row.share }}</span>
        <UsageFacts
          class="account-facts"
          :facts="row.facts"
        />
      </li>
    </ul>
    <ol
      v-if="notes.length"
      class="account-changes"
      :aria-label="t('workItem.usage.accountChanges')"
    >
      <li
        v-for="note in notes"
        :key="note.key"
        class="account-change"
      >
        <span
          v-if="note.number"
          class="account-change-number"
          >{{ note.number }}</span
        >
        <time
          v-if="note.at"
          class="account-change-at"
          :datetime="note.at"
          >{{ note.when }}</time
        ><span
          v-else
          class="account-change-at"
          >{{ note.when }}</span
        >
        <span :class="{ 'account-id': note.id }">{{ note.name }}</span>
      </li>
    </ol>
  </div>
</template>

<style scoped src="@/shared/ui/seriesFill.css"></style>

<style scoped>
.usage-accounts {
  display: grid;
  gap: var(--space-2);
  min-width: 0;
}

/* The changes' numbers over the strip, at the share of its length where each happened. */
.account-plot {
  display: grid;
  gap: var(--space-1);
  min-width: 0;
}

.account-strip {
  position: relative;
  block-size: var(--space-3);
  overflow: clip;
  border-radius: calc(var(--radius-status) / 2);
}

/* A stretch that took no time still shows as a hair, so its change is not lost. */
.account-part {
  position: absolute;
  inset-block: 0;
  min-inline-size: var(--space-hair);
}

/* An organization nobody recorded: the neutral, hatched, which says it apart from any hue. */
.is-unknown {
  mask-image: repeating-linear-gradient(
    135deg,
    black 0 var(--space-half),
    rgb(0 0 0 / 40%) var(--space-half) var(--space-1)
  );
}

/* A change: a line across the strip in the ink of the text, which no hue next to it hides. */
.account-mark {
  position: absolute;
  inset-block: 0;
  inline-size: var(--space-half);
  background: var(--color-text);
  transform: translateX(-50%);

  @media (forced-colors: active) {
    background: CanvasText;
    forced-color-adjust: none;
  }
}

.account-list {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: var(--space-half) var(--space-2);
  padding: 0;
  margin: 0;
  color: var(--color-text);
  font: var(--font-detail);
  font-variant-numeric: tabular-nums;
  list-style: none;
}

.account-row {
  display: grid;
  grid-template-columns: subgrid;
  grid-column: 1 / -1;
  align-items: baseline;
  min-width: 0;
}

.account-swatch {
  align-self: center;
  inline-size: var(--space-3);
  block-size: var(--space-3);
  border-radius: calc(var(--radius-status) / 2);
}

.account-name {
  min-width: 0;
  overflow-wrap: anywhere;
}

.account-share {
  text-align: end;
  white-space: nowrap;
}

.account-facts {
  grid-column: 2 / -1;
  color: var(--color-text-muted);
}

.account-changes {
  display: grid;
  gap: var(--space-1);
  padding: 0;
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-detail);
  list-style: none;
}

.account-change {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1) var(--space-2);
  min-width: 0;
  overflow-wrap: anywhere;
}

.account-change-number {
  color: var(--color-text);
  font-variant-numeric: tabular-nums;
}

.account-change-at {
  color: var(--color-text-tertiary);
}

.account-id {
  font-family: var(--font-family-mono);
}
</style>
