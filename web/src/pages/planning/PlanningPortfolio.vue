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
 *
 * Above the cards «New space» opens the space window empty, and each card of the main store
 * has its sign «Configure space» beside its way in, which opens the window on that space; a
 * card of an attached store has none, as that store is opened read-only. Under the cards the
 * projects in no space are named (`UnplacedProjects`). The ways in are `data-part`
 * `new-space` and `configure`.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { useSpaceWindow } from '@/features/space-window/spaceWindowHost.ts'
import UnplacedProjects from '@/features/space-window/UnplacedProjects.vue'

import type { PlanningSpaceRef } from '@/shared/api/platformPlanningRefs.ts'
import type { PlatformPlanningReady } from '@/shared/api/platformPlanningTypes.ts'
import { vTooltip } from '@/shared/ui/tooltipAnchors.ts'
import VButton from '@/shared/ui/VButton.vue'
import VIcon from '@/shared/ui/VIcon.vue'

defineProps<{ spaces: PlatformPlanningReady['spaces'] }>()
const emit = defineEmits<{ 'open-space': [space: PlanningSpaceRef] }>()
const { t } = useI18n()
const spaceWindow = useSpaceWindow()
/** Whether a space can be created here, which only the main store's writer can. */
const creatable = computed(() => spaceWindow?.creatable() ?? false)
const newSpace = () => spaceWindow?.create()
/** A card of the main store's has «Configure space»; an attached store's is read-only. */
const configurable = (space: PortfolioSpace) => spaceWindow?.editable(space.space_ref) ?? false
const configure = (space: PortfolioSpace) => spaceWindow?.edit(space.space_ref)
/** The sign's accessible name, which says which space it configures. */
const configureName = (space: PortfolioSpace) =>
  t('spaceWindow.configureNamed', { key: space.space_ref.space_key })

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
  <div
    v-if="creatable"
    class="portfolio-head"
  >
    <VButton
      data-part="new-space"
      @click="newSpace"
      ><VIcon
        name="plus"
        :size="15"
      />{{ t('spaceWindow.create') }}</VButton
    >
  </div>
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
      <div class="space-foot">
        <VButton
          v-if="configurable(space)"
          v-tooltip.name="t('spaceWindow.configure')"
          class="space-configure"
          variant="ghost"
          data-part="configure"
          :aria-label="configureName(space)"
          icon
          @click="configure(space)"
        >
          <VIcon
            name="settings"
            :size="20"
          />
        </VButton>
        <VButton
          v-tooltip.clipped="t('platform.planning.openSpace')"
          class="open-space"
          @click="emit('open-space', space.space_ref)"
        >
          <span class="one-line">{{ t('platform.planning.openSpace') }}</span><VIcon
            name="chevron-right"
            :size="15"
          />
        </VButton>
      </div>
    </article>
  </section>
  <UnplacedProjects />
</template>

<style scoped>
/* Cards of 280px at least, as many to a row as fit; never wider than the frame, where a phone's
   is narrower: at 320px a card of 280 stood in a frame of 256 and scrolled it 44px sideways. */
.portfolio-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 280px), 1fr));
  gap: var(--space-3);
}

/* A column whose foot is the card's: a row of cards is as tall as its tallest, and each
   card's way in stands on that foot, whatever the card says above it. Stood after its
   words instead, «Open space» of one row stood 78px apart at 1280px, where one card's
   projects ran to three lines and another's to one. */
.portfolio-space {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
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

/* Four numbers in two rows of two, as a card is never wide enough for four in a row of whole
   words: a column is never narrower than its longest word, which is never broken. */
.space-numbers {
  display: grid;
  grid-template-columns: repeat(2, minmax(min-content, 1fr));
  gap: var(--space-2) var(--space-3);
  margin: 0;
}

.space-number {
  display: grid;
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

/* «New space» stands over the cards at their end edge, where a page's own action stands. */
.portfolio-head {
  display: flex;
  justify-content: flex-end;
}

/* The ways in stand at the foot of the card rather than filling it: the sign that configures
   the space, then the way into it, so both stay on one line at every width. */
.space-foot {
  display: flex;
  gap: var(--space-2);
  align-items: center;
  margin-block-start: auto;
}

/* The way in gives way where the card is narrower than the sign and its words, as a phone's in
   Russian is: its words end in an ellipsis, whole in its hint (One-line labels), so the card keeps
   to its frame. At their own width they ran the card 49px past a frame of 256 at 320px. */
.open-space {
  flex-shrink: 1;
  min-width: 0;
}

/* The sign's glyph stands on the edge the card's words start at, its target reaching out past
   it: the target's own edge there drew the glyph 10px in from every line above it. */
.space-configure {
  --configure-glyph: 20px;

  margin-inline-start: calc(var(--configure-glyph) / 2 - var(--size-control-height) / 2);
}
</style>
