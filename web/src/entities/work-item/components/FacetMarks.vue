<script setup lang="ts">
/**
 * The marks a surface prints for one work item, in the registry's words.
 *
 * Which facets print, in what form and in which tone is the registry's
 * (`facets.ts`) and the state owner's (`uiSystem.ts`) to say; this draws what
 * they answer. A host picks which facets go in this run — a tile puts priority
 * and kind before its reference and the exceptions after it — and the rest is
 * not its decision.
 *
 * A glyph is coloured by its tone and the word beside it stays in the quiet
 * ink: the hue says how much a fact asks, the glyph says which fact it is. A
 * glyph shown alone keeps its word as the accessible name and the hover text;
 * a word shown alone, under a heading that names the fact, takes the tone.
 *
 * A run that must stay on one line folds: when it runs out of room a mark
 * keeps its glyph and its word drops out of sight, still read out and still the
 * hover text. A tile's first line folds, so its marks never push it to two.
 *
 * A mark with short words draws them and keeps its whole words as the name and
 * the hover text: a tile shows «⛔ MAIN-12» and says «Ждёт MAIN-12».
 *
 * A run of label chips that must keep one line fits: as many whole chips as
 * the line has room for, then «+N». The room comes from the line's width and
 * the chips' words, worked out without drawing anything to measure, and is
 * handed to the registry, which still says which chips print and what the
 * count says.
 */
import { computed, useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'

import LabelChip from '@/entities/work-item/components/LabelChip.vue'
import { useLabelRoom } from '@/entities/work-item/composables/useLabelRoom.ts'
import {
  FACET_ORDER,
  facetMarks,
  leadMarks,
  surfaceMarks,
} from '@/entities/work-item/utils/facets.ts'
import type {
  FacetContext,
  FacetId,
  FacetMark,
  FacetSubject,
  FacetSurface,
} from '@/entities/work-item/utils/facets.ts'
import { EMPTY_WORK_FILTER, hasToken } from '@/entities/work-item/utils/workFilter.ts'
import type { WorkFilter, WorkFilterToken } from '@/entities/work-item/utils/workFilter.ts'

import { semanticStatePresentation } from '@/shared/lib/uiSystem.ts'
import SemanticState from '@/shared/ui/SemanticState.vue'
import VIcon from '@/shared/ui/VIcon.vue'

const props = withDefaults(
  defineProps<{
    item: FacetSubject
    surface: FacetSurface
    context?: FacetContext
    /** The facets this run prints, in order; the registry still decides each one. */
    facets?: readonly FacetId[]
    /** The filter in force, so a mark already in it offers to come out. */
    filter?: WorkFilter
    /** Kind, priority and label marks become buttons that filter. */
    filterable?: boolean
    /** Label chips keep one line: the ones with no room fold into «+N». */
    fit?: boolean
    /** The run stays on one line: short of room, a mark shows its glyph alone. */
    fold?: boolean
    /** The glyphs that lead the reference, rather than the facets where the surface says them. */
    lead?: boolean
    /** False inside a container that is one Tab stop. */
    tabbable?: boolean
  }>(),
  {
    facets: () => FACET_ORDER,
    context: () => ({}),
    filter: () => EMPTY_WORK_FILTER,
    filterable: false,
    fold: false,
    fit: false,
    tabbable: true,
    lead: false,
  },
)

const emit = defineEmits<{ filter: [token: WorkFilterToken] }>()

const { t } = useI18n()

const fits = () => props.fit && props.facets.includes('labels')

/** Every chip the registry would print with no line to fit, and the widest count. */
const candidates = computed(() =>
  fits()
    ? facetMarks('labels', props.surface, props.item, props.context)
        .filter((mark) => mark.form === 'chips')
        .map((mark) => mark.value)
    : [],
)
const moreSample = computed(() =>
  fits()
    ? facetMarks('labels', props.surface, props.item, { ...props.context, labelRoom: 1 }).find(
        (mark) => mark.form !== 'chips',
      )
    : undefined,
)

/**
 * Only a run that fits its chips measures its line. Every other run — a list
 * row draws seven — is spared the observer, its watcher and its room; `fit`
 * says which run a host placed where, not a state that changes, so it is read
 * once.
 */
const room = props.fit
  ? useLabelRoom(useTemplateRef<HTMLElement>('line'), {
      candidates: () => candidates.value,
      enabled: fits,
      more: () => (moreSample.value ? word(moreSample.value) : undefined),
      total: () => props.item.labels?.length ?? 0,
    })
  : undefined

/** What the registry is asked with: the host's context, and the room the line measured. */
const asked = computed(() =>
  room?.value === undefined ? props.context : { ...props.context, labelRoom: room.value },
)

const marks = computed(() =>
  props.lead
    ? props.facets.flatMap((facet) => leadMarks(facet, props.surface, props.item, asked.value))
    : surfaceMarks(props.surface, props.item, asked.value, props.facets),
)

const say = (text: FacetMark['text']) =>
  'literal' in text ? text.literal : t(text.key, text.params ?? {})

/** The mark's whole words: its name, and what it draws unless it has short ones. */
const word = (mark: FacetMark) => say(mark.text)

/**
 * One mark as it is drawn. Its words are looked up once a render: the template
 * asked for a filter mark's name twice and its word up to four times, in every
 * cell of every row of a list.
 */
interface DrawnMark {
  /** The mark is in the filter now. */
  active: boolean
  /** Absent rather than false: the attribute is what the style reads. */
  activeMark: true | undefined
  /** A pressed mark: a button that filters. */
  filters: boolean
  /** The glyph is drawn and its word is only read out. */
  glyphOnly: boolean
  key: string
  mark: FacetMark
  /** «Фильтр: тип Улучшение», or the way back out of it. */
  name: string | undefined
  /** Shorter words drawn in place of the whole ones. */
  short: string | undefined
  /** A mark that filters is a button; every other mark is text. */
  tag: 'button' | 'span'
  /** What a pointer shows: what a click does, or the words a glyph or short words stand for. */
  title: string | undefined
  type: 'button' | undefined
  /** The mark's whole words. */
  word: string
  /** A `word` is the word alone: a column's heading already names the fact. */
  wordOnly: boolean
}

/** «Фильтр: тип Улучшение», or the way back out of it. */
function filterName(mark: FacetMark, active: boolean, whole: string) {
  return t(active ? 'workItem.facet.filterRemove' : 'workItem.facet.filterAdd', {
    facet: t(`workItem.facet.name.${mark.facet}`),
    value: whole,
  })
}

function present(mark: FacetMark): DrawnMark {
  const whole = word(mark)
  const filters = props.filterable && mark.filter !== null
  const active = mark.filter !== null && hasToken(props.filter, mark.filter)
  const name = filters ? filterName(mark, active, whole) : undefined
  const glyphOnly = mark.form === 'glyph' && mark.glyph !== null
  // A glyph whose word may fold out of sight tells the pointer its word.
  const foldable = props.fold && mark.glyph !== null
  return {
    active,
    activeMark: active || undefined,
    filters,
    glyphOnly,
    key: `${mark.facet}:${mark.value}`,
    mark,
    name,
    short: mark.short && say(mark.short),
    tag: filters ? 'button' : 'span',
    title: name ?? (glyphOnly || foldable || mark.short ? whole : undefined),
    type: filters ? 'button' : undefined,
    word: whole,
    wordOnly: mark.form === 'word',
  }
}

const drawn = computed(() => marks.value.map((mark) => present(mark)))

/**
 * A pressed mark is out of the Tab order inside a container that is one Tab
 * stop; every other mark, and a pressed one anywhere else, has the default
 * order, which is the attribute being absent.
 */
const tabStop = (entry: DrawnMark) => (entry.filters && !props.tabbable ? -1 : undefined)

function press(mark: FacetMark, event: MouseEvent) {
  if (!mark.filter) return
  event.stopPropagation()
  emit('filter', mark.filter)
}

function pressLabel(label: string) {
  emit('filter', { facet: 'labels', value: label })
}
</script>

<template>
  <span
    ref="line"
    class="facet-marks"
    :class="{ fold: props.fold, fit: props.fit }"
    :data-surface="props.surface"
  >
    <template
      v-for="entry in drawn"
      :key="entry.key"
    >
      <LabelChip
        v-if="entry.mark.form === 'chips'"
        class="facet-chip"
        :label="entry.mark.value"
        :active="entry.active"
        :filterable="props.filterable"
        :tabbable="props.tabbable"
        @filter="pressLabel"
      />
      <SemanticState
        v-else-if="entry.mark.facet === 'state' && !entry.mark.glyph"
        class="facet-state"
        dimension="work-item-state"
        :state="entry.mark.value"
        :label="entry.word"
      />
      <component
        :is="entry.tag"
        v-else
        class="facet-mark"
        :class="{ quiet: entry.mark.quiet, filters: entry.filters }"
        :type="entry.type"
        :data-facet="entry.mark.facet"
        :data-tone="semanticStatePresentation(entry.mark.tone).tone"
        :data-active="entry.activeMark"
        :aria-label="entry.name"
        :title="entry.title"
        :tabindex="tabStop(entry)"
        @click="press(entry.mark, $event)"
      >
        <VIcon
          v-if="entry.mark.glyph && !entry.wordOnly"
          class="facet-glyph"
          :name="entry.mark.glyph"
          :size="14"
          :stroke-width="2"
        />
        <template v-if="entry.short !== undefined">
          <span
            class="facet-word"
            aria-hidden="true"
            >{{ entry.short }}</span
          >
          <span class="facet-word-hidden">{{ entry.word }}</span>
        </template>
        <!-- A word alone is a word of its own, which takes the mark's tone. -->
        <span
          v-else-if="entry.wordOnly"
          class="facet-word facet-word-alone"
          >{{ entry.word }}</span
        >
        <span
          v-else
          class="facet-word"
          :class="{ 'facet-word-hidden': entry.glyphOnly }"
          >{{ entry.word }}</span
        >
      </component>
    </template>
  </span>
</template>

<style scoped>
.facet-marks {
  display: inline-flex;
  flex-wrap: wrap;
  gap: var(--space-1) var(--space-2);
  align-items: center;
  min-width: 0;
  color: var(--color-text-muted);
  font: var(--font-detail);
}

.facet-mark {
  display: inline-flex;
  gap: var(--space-1);
  align-items: center;
  min-width: 0;
  padding: 0;
  border: 0;
  color: inherit;
  font: inherit;
  background: none;

  &.filters {
    /* Above a stretched open target drawn earlier in the same container. */
    position: relative;

    /* A glyph is 14px; the target is the 28px a line of content may spend,
       centred on it, so neighbouring glyphs do not share a hit area. */
    justify-content: center;
    min-inline-size: var(--size-control-inline);
    min-block-size: var(--size-control-inline);
    border-radius: var(--radius-status);
    cursor: pointer;

    &:hover .facet-word {
      color: var(--color-text);
    }

    &:focus-visible {
      outline: 2px solid var(--color-focus-ring);
      outline-offset: 2px;
    }
  }
}

.facet-word {
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;

  /* A word alone carries the tone its glyph would have: with no glyph beside
     it, the word is the only place left to say how much the fact asks. It
     comes before the quiet, picked and hovered inks, which say something else
     and win a tie. */
  .facet-mark[data-tone='info'] &:where(.facet-word-alone) {
    color: var(--color-info);
  }

  .facet-mark[data-tone='success'] &:where(.facet-word-alone) {
    color: var(--color-success);
  }

  .facet-mark[data-tone='warning'] &:where(.facet-word-alone) {
    color: var(--color-warning);
  }

  .facet-mark[data-tone='danger'] &:where(.facet-word-alone) {
    color: var(--color-danger);
  }

  .facet-mark.quiet & {
    color: var(--color-text-tertiary);
  }

  .facet-mark[data-active] & {
    color: var(--color-text);
  }
}

/* One line, whatever the room: the run does not wrap, and inside a mark the
   word wraps under its glyph onto a line that is clipped, so a mark short of
   room shows its glyph alone. The word is still in the mark, so it is still
   read out, and the hover text says it. */
.facet-marks.fold {
  flex-wrap: nowrap;
  max-width: 100%;

  /* Folded, the glyph keeps the end of the run, where the whole mark ended. */
  .facet-mark {
    flex-wrap: wrap;
    justify-content: flex-end;
    max-block-size: 1lh;
    overflow: hidden;
  }
}

/* A mark lines up with the text beside it on its first item, and the first
   item was the glyph, whose lower edge stood in for a baseline: the word sat
   two pixels above the row. A zero-width letter ahead of the glyph, centred as
   the word is, gives the mark a letter's baseline; it takes no room, and it
   says nothing to a screen reader. */
.facet-mark::before {
  content: '\200b' / '';
  margin-inline-end: calc(-1 * var(--space-1));
}

/* One line of chips: a chip with no room is not drawn at all — the registry
   counts it in «+N» — and the last one drawn may shorten rather than spill. The
   chips' 28px pointer boxes are the line's height, once. */
.facet-marks.fit {
  flex-wrap: nowrap;
  max-width: 100%;

  .facet-chip {
    flex: 0 1 auto;
    min-width: 0;
  }

  .facet-mark {
    flex: none;
  }
}

/* The glyph alone on screen, its word still read out. */
.facet-word-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  white-space: nowrap;
  overflow: hidden;
  clip-path: inset(50%);
}

/* A glyph is tertiary ink unless its tone says more. Kind never does: a type
   is not a state, and a coloured kind would read as one more alarm. */
.facet-glyph {
  flex: 0 0 auto;
  color: var(--color-text-tertiary);

  .facet-mark[data-tone='info'] & {
    color: var(--color-info);
  }

  .facet-mark[data-tone='success'] & {
    color: var(--color-success);
  }

  .facet-mark[data-tone='warning'] & {
    color: var(--color-warning);
  }

  .facet-mark[data-tone='danger'] & {
    color: var(--color-danger);
  }
}
</style>
