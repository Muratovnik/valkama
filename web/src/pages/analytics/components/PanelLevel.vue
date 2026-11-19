<script setup lang="ts">
/**
 * One level of what the Analytics panel lays out: a section of the panel, a group in it such as
 * an account of the quota, or a block such as a chart or a window. Each level is declared here
 * once, with the air between what it holds: the groups of a section stand 24px apart, the blocks
 * of a group 16px and the lines of a block 8px. Its heading takes the type the scale gives its
 * level, 16px over a section, 15px over a group and 14px over a block, from the one stylesheet
 * every heading of a level reads (`headingLevels.css`), so no heading is the size of the level
 * over it. The heading's element is not the level's but its place in the outline, one rank under
 * the heading of the level around it (`usePanelOutline`). The panel shows one section at a time,
 * so the 36px between two sections has no place on it yet. The air between the parts of a section
 * is one token, `--space-section-part`: a pair of blocks a section lays out side by side, which
 * stack on a narrow panel, stands that far apart one under the other, so the air after every part
 * of the section is the same whichever view each block shows.
 *
 * The heading row holds the heading, what stands beside it (`beside`: a plan, a fact, a menu) and
 * the controls that act on the whole level, each at the one size a heading's control takes, at the
 * row's end. Everything on a line of the row shares one centre line: an icon-only control has no
 * baseline of its own, and aligned by baselines the menu at an account's name stood 3px above
 * «Name» beside it. A heading that wraps takes its line alone, so nothing beside it is centred on
 * more than one of its lines. A row that wraps puts a control under a long heading; a row of one line (`oneLine`)
 * cuts the heading short with an ellipsis instead, its whole words in a hint while they are cut,
 * so its controls stay on its line, as a window of the quota keeps its name and «Breakdown»
 * there. A caveat that qualifies the whole level — that a cost is an estimate, what the tokens
 * count, that the period does not reach the quota — is said once, in the «ⓘ» that ends the heading's line
 * (`about`), never as a line of the page; it opens on a press, so a finger reaches it too
 * (`InfoTip`). It is named «About this section», and a level that is no section names it for what
 * it qualifies (`aboutLabel`), as the figures of a value's side panel do. The quota once opened on
 * two sentences of what does not apply to it, which pushed its accounts down on every visit. What
 * the level holds stands one under the next, two side by side where both read well (`pair`), or as
 * many side by side as keep `columnMin` (`fit`); a part that must take the whole width says so on
 * its own root. A group may stand on a surface of its own, and what it holds side by side may stand
 * as far apart as the surface's inset (`apart`), as the windows of an account of the quota do.
 *
 * Blocks side by side whose parts must line up row by row, as two windows of an account whose
 * plots must start at one height, each lay themselves on as many rows of the grid that holds them
 * (`rows`): the heading row on the first and what they hold on the rest, each part of it laying
 * its own parts on those rows in turn (a subgrid), so a row is as tall as the tallest of its
 * neighbours' and every part starts level with theirs. Laid out each on its own, the plot of a
 * window that had reset, led by two lines, stood 41px under its neighbour's.
 *
 * A heading that changes while the level stands, as a chart's names the page's measure, keeps the
 * room of every heading it takes in turn (`titles`): the others stand unseen in its place, so the
 * row is as wide and as tall as the widest and the controls beside it wrap alike whichever stands.
 * The switch over the tasks' chart once took a line of its own under the agents' time and none
 * under the tokens, and choosing a measure moved the table under it.
 *
 * What a reader of the page selects it by: the level is `data-level`, its kind; its heading row is
 * `data-level-head`.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { useLevelHeading } from '@/pages/analytics/composables/usePanelOutline.ts'

import InfoTip from '@/shared/ui/InfoTip.vue'
import LineEnd from '@/shared/ui/LineEnd.vue'
import { vSlashBreaks } from '@/shared/ui/slashBreaks.ts'
import { vTooltip } from '@/shared/ui/tooltipAnchors.ts'
import VButton from '@/shared/ui/VButton.vue'
import VIcon from '@/shared/ui/VIcon.vue'

type Level = 'section' | 'group' | 'block'

const props = withDefaults(
  defineProps<{
    level: Level
    /** The caveats of the whole level, each a sentence, said in the «ⓘ» of its heading. */
    about?: readonly string[]
    /** The «ⓘ»'s name, its button's and its caveats'; «About this section» where it is unset. */
    aboutLabel?: string
    /** What the level holds side by side stands 32px apart, a surface's inset, not its level's gap. */
    apart?: boolean
    /** The element the level is; a group of a list is its item. */
    as?: 'section' | 'div' | 'li'
    /** The element of what the level holds: a list of groups is a list. */
    bodyAs?: 'div' | 'ul'
    /** The list's name, said to a screen reader, when what the level holds is a list. */
    bodyLabel?: string
    /** The narrowest a part stands in `fit` columns. */
    columnMin?: string
    columns?: 'one' | 'pair' | 'fit'
    /** The heading row keeps one line: the heading is cut short before its controls wrap. */
    oneLine?: boolean
    /** How many rows of the grid that holds it the level lays itself on, its heading on the first. */
    rows?: number
    /** Whether the level stands on a surface of its own. */
    surface?: boolean
    /** The heading's words; a heading with more than words takes the `heading` slot. */
    title?: string
    /** Every heading the level takes in turn, `title` among them, whose room the row keeps. */
    titles?: readonly string[]
  }>(),
  {
    apart: false,
    as: 'section',
    title: '',
    bodyAs: 'div',
    columns: 'one',
    columnMin: '20rem',
    oneLine: false,
    rows: undefined,
    surface: false,
    bodyLabel: undefined,
    about: () => [],
    aboutLabel: undefined,
    titles: () => [],
  },
)

/** The size a control of the heading row takes. */
const ACTION_SIZE = 'compact'

const slots = defineSlots<{
  actions?: (scope: { size: typeof ACTION_SIZE }) => unknown
  beside?: () => unknown
  default?: () => unknown
  heading?: () => unknown
}>()

const { t } = useI18n()

const headed = computed(() => props.title !== '' || Boolean(slots.heading))
/** The heading's element is its place in the outline, one under the level around it. */
const headingAs = useLevelHeading(() => headed.value)
/** The «ⓘ» stands at a heading: a level with no heading has no line for it to end. */
const caveats = computed(() => (headed.value ? props.about : []))
const aboutName = computed(() => props.aboutLabel ?? t('analytics.about.label'))
/** The heading's whole words for its hint while a row of one line cuts them short; none else. */
const cutTitle = computed(() => (props.oneLine ? props.title : ''))
/** The other headings the level takes in turn, each held unseen in the heading's place. */
const rivals = computed(() =>
  props.title ? [...new Set(props.titles)].filter((other) => other !== props.title) : [],
)
/** The level's own style: the narrowest a part stands, and the rows it lays itself on. */
const levelStyle = computed(() => ({
  '--level-column-min': props.columnMin,
  ...(props.rows ? { '--level-rows': props.rows, '--level-body-rows': props.rows - 1 } : {}),
}))
</script>

<template>
  <component
    :is="as"
    class="panel-level"
    :class="[
      `level-${level}`,
      `columns-${columns}`,
      { 'level-surface': surface, 'level-apart': apart, 'level-rows': rows },
    ]"
    :data-level="level"
    :style="levelStyle"
  >
    <div
      v-if="headed || $slots.beside || $slots.actions"
      class="level-head"
      :class="{ 'level-head-line': oneLine }"
      data-level-head
    >
      <component
        :is="headingAs"
        v-if="$slots.heading"
        class="level-heading"
        :class="`heading-${level}`"
      >
        <slot name="heading" />
      </component>
      <span
        v-else-if="title && rivals.length"
        class="level-title"
      >
        <component
          :is="headingAs"
          v-slash-breaks="title"
          class="level-heading"
          :class="`heading-${level}`"
        />
        <span
          v-for="rival in rivals"
          :key="rival"
          v-slash-breaks="rival"
          class="level-title-room"
          aria-hidden="true"
          :class="`heading-${level}`"
        />
      </span>
      <component
        :is="headingAs"
        v-else-if="title"
        v-slash-breaks="title"
        v-tooltip.clipped="cutTitle"
        class="level-heading"
        :class="[`heading-${level}`, { 'one-line': oneLine }]"
      />
      <LineEnd
        v-if="caveats.length"
        class="level-about"
        :class="`heading-${level}`"
      >
        <InfoTip :label="aboutName">
          <div class="level-about-caveats">
            <p
              v-for="caveat in caveats"
              :key="caveat"
              class="level-about-caveat"
            >
              {{ caveat }}
            </p>
          </div>
          <template #trigger="{ toggle, popup }">
            <VButton
              class="level-about-press"
              variant="ghost"
              :size="ACTION_SIZE"
              :aria-label="aboutName"
              :aria-controls="popup.controls"
              :aria-expanded="popup.expanded"
              icon
              @click="toggle"
            >
              <VIcon
                name="info"
                :size="16"
              />
            </VButton>
          </template>
        </InfoTip>
      </LineEnd>
      <slot name="beside" />
      <div
        v-if="$slots.actions"
        class="level-actions"
      >
        <slot
          name="actions"
          :size="ACTION_SIZE"
        />
      </div>
    </div>
    <component
      :is="bodyAs"
      v-if="$slots.default"
      class="level-body"
      :aria-label="bodyLabel"
    >
      <slot />
    </component>
  </component>
</template>

<style scoped src="@/shared/ui/headingLevels.css"></style>

<style scoped>
/* The heading row 12px over what the level holds, as every heading stands over its content.
   What stands on a line of the row is centred on it: the heading, the words and the controls
   beside it, an icon-only one among them, and the controls at its end. */
.panel-level {
  --level-column-min: 20rem;
  --level-rows: 2;
  --level-body-rows: 1;

  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--space-3);
  align-content: start;
  min-width: 0;
}

.level-head {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1) var(--space-3);
  align-items: center;
  min-width: 0;
}

.level-heading {
  min-width: 0;
  margin: 0;
  overflow-wrap: anywhere;
}

/* The heading and the others it takes in turn in one cell, those unseen: the cell is as wide and
   as tall as the widest of them, whichever stands. */
.level-title {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  min-width: 0;

  > * {
    grid-area: 1 / 1;
  }
}

.level-title-room {
  overflow-wrap: anywhere;
  visibility: hidden;
}

/* The «ⓘ» ends the heading's line, centred on it in the heading's own font (`LineEnd`, the
   level's rules below); its caveats stand one under the next, a block's lines apart. */
.level-about-caveats {
  display: grid;
  gap: var(--space-2);
}

.level-about-caveat {
  margin: 0;
}

/* A row of one line: the heading takes what its controls leave it and is cut short there, by the
   shared rule of a line that ends in an ellipsis (`.one-line`). */
.level-head-line {
  flex-wrap: nowrap;

  > .level-heading {
    flex: 0 1 auto;
  }
}

/* The controls stand at the row's end. */
.level-actions {
  display: flex;
  flex: 0 0 auto;
  gap: var(--space-1);
  align-items: center;
  margin-inline-start: auto;
}

.level-body {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  align-items: start;
  min-width: 0;
  padding: 0;
  margin: 0;
  list-style: none;
}

/* The heading and its «ⓘ» take their level's type from the scale (`headingLevels.css`); the air
   between what each level holds is the level's own, a section's the one token two blocks it lays
   out side by side read as well (`--space-section-part`). */
.level-section > .level-body {
  gap: var(--space-section-part);
}

.level-group > .level-body {
  gap: var(--space-4);
}

.level-apart > .level-body {
  column-gap: var(--space-8);
}

.level-block > .level-body {
  gap: var(--space-2);
}

/* Laid on rows of the grid that holds it, the heading on the first and what it holds on the rest,
   each at the level's own air (`rows`). */
.level-rows {
  grid-template-rows: subgrid;
  grid-row: span var(--level-rows);

  > .level-body {
    grid-template-rows: subgrid;
    grid-row: span var(--level-body-rows);
  }
}

/* On a surface of its own, which a chart's table in it stands on (`--color-chart-table-ground`). */
.level-surface {
  --color-chart-table-ground: var(--color-surface);

  padding: var(--space-4);
  background: var(--color-surface);
  border-radius: var(--radius-card);
}

/* What it holds side by side where its width allows: its own width, so a query reads it. */
.columns-pair,
.columns-fit {
  container-type: inline-size;
}

.columns-fit > .level-body {
  grid-template-columns: repeat(auto-fit, minmax(min(100%, var(--level-column-min)), 1fr));
}

@container (width >= 48rem) {
  .columns-pair > .level-body {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
