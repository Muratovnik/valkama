<script setup lang="ts">
/**
 * What the latest attempt cost, and how much of that anyone actually saw.
 *
 * Every number here carries how it was obtained, and the section is built
 * around that rather than around the numbers. A dashboard that renders an
 * unknown as `0` is worse than one that renders nothing: zero looks like a
 * measurement, and a reader who sees "0 tokens" concludes the attempt was
 * cheap rather than that no journal was configured.
 *
 * So the rules here are: an unobserved value is a dash and never a zero; a
 * field the source does not carry says so in its own words; a total assembled
 * from some of an attempt's sessions says which ones did not answer; and the
 * tools table counts calls and outcomes with no token attribution, because a
 * hook reports that a tool ran and not what it cost.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import type { ExecutionUsage } from '@/shared/api/executionModel.ts'
import SectionHeading from '@/shared/ui/SectionHeading.vue'

const props = defineProps<{
  error: string
  loading: boolean
  usage: ExecutionUsage | null
}>()

const { t, n } = useI18n()

/**
 * The token rows, in the order a reader reads them.
 *
 * Not in the order they add up, because two of them do not: a cache read is
 * counted again on every request that reuses the prefix, and a cache write once
 * for what was stored. They are separate rows for exactly that reason.
 */
const TOKEN_FIELDS = [
  'input',
  'cached_read',
  'cache_write',
  'output',
  'reasoning',
  'total',
] as const

const tokens = computed(() =>
  TOKEN_FIELDS.map((name) => ({
    name,
    label: t(`usage.token.${name}`),
    ...describe(props.usage?.tokens[name]),
  })),
)

const wall = computed(() => describeDuration(props.usage?.duration.wall_ms.value ?? null))

/** Which sessions of this attempt answered nothing, so a partial total says why. */
const silent = computed(() => (props.usage?.sessions ?? []).filter((entry) => !entry.observed))

const models = computed(() => (props.usage?.models ?? []).map((entry) => entry.id).join(', '))

/**
 * One value, rendered as what it is. `unsupported` is its own answer: the
 * source carries no such field, which is a reason to stop looking rather than
 * a gap to fill in later.
 */
function describe(field: { quality: string; value: number | null } | undefined) {
  if (!field || field.value === null)
    return { text: field?.quality === 'unsupported' ? t('usage.unsupported') : t('usage.unknown') }
  return { text: n(field.value) }
}

function describeDuration(value: number | null): string {
  if (value === null) return t('usage.unknown')
  const seconds = Math.round(value / 1000)
  if (seconds < 60) return t('usage.seconds', { seconds })
  return t('usage.minutes', { minutes: Math.round(seconds / 60) })
}
</script>

<template>
  <section class="usage">
    <SectionHeading
      as="h3"
      level="panel"
      >{{ t('usage.heading') }}</SectionHeading
    >

    <p
      v-if="loading"
      class="quiet"
      role="status"
    >
      {{ t('usage.loading') }}
    </p>
    <p
      v-else-if="error"
      class="usage-error"
      role="alert"
    >
      {{ error }}
    </p>
    <p
      v-else-if="!usage"
      class="quiet"
    >
      {{ t('usage.none') }}
    </p>

    <template v-else>
      <p class="quiet">
        {{ t('usage.intro', { adapter: usage.provenance.adapter_id || t('usage.noAdapter') }) }}
      </p>

      <dl class="usage-facts">
        <div
          v-for="row in tokens"
          :key="row.name"
          class="usage-fact"
        >
          <dt class="fact-name">{{ row.label }}</dt>
          <dd class="fact-value">{{ row.text }}</dd>
        </div>
        <div class="usage-fact">
          <dt class="fact-name">{{ t('usage.wall') }}</dt>
          <dd class="fact-value">{{ wall }}</dd>
        </div>
        <div class="usage-fact">
          <dt class="fact-name">{{ t('usage.models') }}</dt>
          <dd class="fact-value">{{ models || t('usage.unknown') }}</dd>
        </div>
      </dl>

      <!-- The coverage line is the honest half of every total above it. -->
      <p class="usage-coverage">
        {{
          t('usage.coverage', {
            tokens: t(`usage.coverageState.${usage.coverage.tokens}`),
            tools: t(`usage.coverageState.${usage.coverage.tools}`),
          })
        }}
      </p>
      <ul
        v-if="silent.length"
        class="usage-silent"
      >
        <li
          v-for="entry in silent"
          :key="entry.session_id"
        >
          {{ t('usage.silentSession', { client: entry.client, reason: entry.reason }) }}
        </li>
      </ul>

      <SectionHeading
        as="h4"
        level="panel"
        >{{ t('usage.tools') }}</SectionHeading
      >
      <p
        v-if="!usage.tools.length"
        class="quiet"
      >
        {{ t('usage.noTools') }}
      </p>
      <table
        v-else
        class="tool-table"
      >
        <caption class="visually-hidden">
          {{
            t('usage.toolsCaption')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('usage.tool') }}</th>
            <th scope="col">{{ t('usage.calls') }}</th>
            <th scope="col">{{ t('usage.errors') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="entry in usage.tools"
            :key="`${entry.server}-${entry.name}`"
          >
            <th
              scope="row"
              class="tool-name"
            >
              {{ entry.name }}
            </th>
            <td class="tool-count">{{ entry.calls }}</td>
            <td class="tool-count">{{ entry.errors }}</td>
          </tr>
        </tbody>
      </table>
    </template>
  </section>
</template>

<style scoped>
.usage {
  display: grid;
  gap: var(--space-3);
}

.quiet {
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-detail);
}

.usage-error {
  margin: 0;
  color: var(--color-danger);
  font: var(--font-detail);
}

.usage-facts {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
  gap: var(--space-2) var(--space-4);
  margin: 0;
}

.usage-fact {
  display: grid;
  gap: var(--space-hair);
  min-width: 0;
}

.fact-name {
  color: var(--color-text-tertiary);
  font: var(--font-detail);
}

.fact-value {
  margin: 0;
  color: var(--color-text);
  font: var(--font-line);
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}

.usage-coverage {
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-detail);
}

.usage-silent {
  display: grid;
  gap: var(--space-1);
  padding: 0;
  margin: 0;
  color: var(--color-text-tertiary);
  font: var(--font-detail);
  list-style: none;
}

.tool-table {
  width: 100%;
  font: var(--font-line);
  border-collapse: collapse;
}

.tool-name {
  font-weight: inherit;
  text-align: start;
  overflow-wrap: anywhere;
}

.tool-count {
  width: 5rem;
  font-variant-numeric: tabular-nums;
  text-align: end;
}
</style>
