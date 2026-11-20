<script setup lang="ts">
/**
 * Every space this workstation has, at «All spaces», with its projects.
 *
 * The space's name leads each card and its key stands under it, as the space choice names
 * it. Under them its four numbers, counted as the space's Volumes page counts them: the cards in
 * triage, the tasks ready and in progress, the questions waiting for the owner. Then its work
 * and its projects in one line, and the way in at the foot: a space is a thing you read first
 * and enter second. A space without numbers shows each as «—», never 0, and says why: an
 * earlier build wrote its store, or its store could not be read.
 *
 * Each number carries `data-number` (`triage`, `ready`, `active`, `waiting_owner`), its name
 * and figure `data-part` `label` and `figure`; the reason for no numbers is `data-part="absent"`.
 */
import { useI18n } from 'vue-i18n'

import type { PlanningSpaceRef } from '@/shared/api/platformPlanningRefs.ts'
import type { PlatformPlanningReady } from '@/shared/api/platformPlanningTypes.ts'
import VButton from '@/shared/ui/VButton.vue'
import VIcon from '@/shared/ui/VIcon.vue'

defineProps<{ spaces: PlatformPlanningReady['spaces'] }>()
const emit = defineEmits<{ 'open-space': [space: PlanningSpaceRef] }>()
const { t } = useI18n()

type PortfolioSpace = PlatformPlanningReady['spaces'][number]

const NUMBERS = ['triage', 'ready', 'active', 'waiting_owner'] as const
const ABSENT = '—'

/** A number's name: a category's own, and the Volumes page's for the questions. */
function numberLabel(key: (typeof NUMBERS)[number]): string {
  return key === 'waiting_owner' ? t('volumes.numbers.waiting') : t(`workItem.category.${key}`)
}

/** The space's four numbers as drawn, each «—» where the read gives none. */
function numbersOf(space: PortfolioSpace) {
  return NUMBERS.map((key) => ({
    key,
    label: numberLabel(key),
    figure: space.numbers === null ? ABSENT : String(space.numbers[key]),
  }))
}

/** The space's projects in one line, or that it has none. */
function projectsLine(space: PortfolioSpace): string {
  const names = space.projects.map((project) => project.display_name)
  return names.length ? names.join(' · ') : t('platform.planning.noProjects')
}
</script>

<template>
  <section class="portfolio-grid">
    <article
      v-for="space in spaces"
      :key="`${space.space_ref.data_scope_id}:${space.space_ref.space_key}`"
      class="portfolio-space"
    >
      <header class="space-head">
        <strong class="space-title">{{ space.title }}</strong>
        <small class="space-key">{{ space.space_ref.space_key }}</small>
      </header>
      <dl
        class="space-numbers"
        :aria-label="t('platform.planning.numbers')"
      >
        <div
          v-for="number in numbersOf(space)"
          :key="number.key"
          class="space-number"
          :data-number="number.key"
        >
          <dt
            class="number-label"
            data-part="label"
          >
            {{ number.label }}
          </dt>
          <dd
            class="number-figure"
            data-part="figure"
          >
            {{ number.figure }}
          </dd>
        </div>
      </dl>
      <p
        v-if="space.numbers_absent"
        class="numbers-absent"
        data-part="absent"
      >
        {{ t(`platform.planning.numbersAbsent.${space.numbers_absent}`) }}
      </p>
      <!-- A space whose store could not be read has no count to show. -->
      <span
        v-if="space.work_item_count !== null"
        class="space-count"
        >{{ t('platform.planning.workItemCount', { count: space.work_item_count }) }}</span
      >
      <div class="space-projects">
        <span class="projects-label">{{ t('platform.planning.projects') }}</span>
        <span class="projects-names">{{ projectsLine(space) }}</span>
      </div>
      <VButton
        class="open-space"
        @click="emit('open-space', space.space_ref)"
      >
        {{ t('platform.planning.openSpace')
        }}<VIcon
          name="chevron-right"
          :size="15"
        />
      </VButton>
    </article>
  </section>
</template>

<style scoped>
.portfolio-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: var(--space-3);
}

.portfolio-space {
  display: grid;
  gap: var(--space-3);
  align-content: start;
  padding: var(--space-4);
  background: var(--color-surface);
  border-radius: var(--radius-card);
}

.space-head {
  display: grid;
  gap: var(--space-1);
}

.space-title {
  font: var(--font-name);
}

.space-key {
  color: var(--color-text-muted);
  font: var(--font-detail);
}

/* Four numbers in a row, two rows of two where the card has no room for four: a number is never
   narrower than its longest word, which is never broken. */
.space-numbers {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin: 0;
}

.space-number {
  display: grid;
  flex: 1 1 5rem;
  gap: var(--space-half);
  align-content: start;
}

.number-label {
  color: var(--color-text-muted);
  font: var(--font-detail);
  overflow-wrap: normal;
}

.number-figure {
  margin: 0;
  font: var(--font-section-title);
  font-variant-numeric: tabular-nums;
}

.numbers-absent {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-dense);
}

.space-count {
  font-size: var(--font-size-dense);
}

.space-projects {
  display: grid;
  gap: var(--space-1);
  font-size: var(--font-size-dense);
}

.projects-label {
  color: var(--color-text-muted);
  font-size: var(--font-size-meta);
}

/* The action stands at the foot of the card rather than filling it. */
.open-space {
  justify-self: start;
}
</style>
