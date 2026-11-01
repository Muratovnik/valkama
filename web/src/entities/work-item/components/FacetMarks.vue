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
 * glyph shown alone keeps its word as the accessible name and the hover text.
 *
 * A run that must stay on one line folds: when it runs out of room a mark
 * keeps its glyph and its word drops out of sight, still read out and still the
 * hover text. A tile's first line folds, so its marks never push it to two.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import LabelChip from '@/entities/work-item/components/LabelChip.vue'
import { FACET_ORDER, surfaceMarks } from '@/entities/work-item/utils/facets.ts'
import type {
  FacetContext,
  FacetId,
  FacetItem,
  FacetMark,
  FacetSurface,
} from '@/entities/work-item/utils/facets.ts'
import { EMPTY_WORK_FILTER, hasToken } from '@/entities/work-item/utils/workFilter.ts'
import type { WorkFilter, WorkFilterToken } from '@/entities/work-item/utils/workFilter.ts'

import { semanticStatePresentation } from '@/shared/lib/uiSystem.ts'
import SemanticState from '@/shared/ui/SemanticState.vue'
import VIcon from '@/shared/ui/VIcon.vue'

const props = withDefaults(
  defineProps<{
    item: FacetItem
    surface: FacetSurface
    context?: FacetContext
    /** The facets this run prints, in order; the registry still decides each one. */
    facets?: readonly FacetId[]
    /** The filter in force, so a mark already in it offers to come out. */
    filter?: WorkFilter
    /** Kind, priority and label marks become buttons that filter. */
    filterable?: boolean
    /** The run stays on one line: short of room, a mark shows its glyph alone. */
    fold?: boolean
    /** False inside a container that is one Tab stop. */
    tabbable?: boolean
  }>(),
  {
    facets: () => FACET_ORDER,
    context: () => ({}),
    filter: () => EMPTY_WORK_FILTER,
    filterable: false,
    fold: false,
    tabbable: true,
  },
)

const emit = defineEmits<{ filter: [token: WorkFilterToken] }>()

const { t } = useI18n()

const marks = computed(() => surfaceMarks(props.surface, props.item, props.context, props.facets))

const word = (mark: FacetMark) =>
  'literal' in mark.text ? mark.text.literal : t(mark.text.key, mark.text.params ?? {})

const filters = (mark: FacetMark) => props.filterable && mark.filter !== null

const active = (mark: FacetMark) => mark.filter !== null && hasToken(props.filter, mark.filter)

/** «Фильтр: тип Улучшение», or the way back out of it. */
function filterName(mark: FacetMark): string | undefined {
  if (!filters(mark)) return undefined
  return t(active(mark) ? 'workItem.facet.filterRemove' : 'workItem.facet.filterAdd', {
    facet: t(`workItem.facet.name.${mark.facet}`),
    value: word(mark),
  })
}

/** A mark that filters is a button; every other mark is text. */
const tag = (mark: FacetMark) => (filters(mark) ? 'button' : 'span')
const buttonType = (mark: FacetMark) => (filters(mark) ? 'button' : undefined)

/** Absent rather than false: the attribute is what the style reads. */
const activeMark = (mark: FacetMark) => active(mark) || undefined

/** The glyph is drawn and its word is only read out. */
const glyphOnly = (mark: FacetMark) => mark.form === 'glyph' && mark.glyph !== null

/** A glyph whose word may fold out of sight, so the pointer is told it. */
const foldable = (mark: FacetMark) => props.fold && mark.glyph !== null

/** What a pointer shows: what a click does, or the word a glyph stands for. */
const hoverText = (mark: FacetMark) =>
  filterName(mark) ?? (glyphOnly(mark) || foldable(mark) ? word(mark) : undefined)

/**
 * Out of the Tab order inside a container that is one Tab stop; the default
 * order everywhere else, which is the attribute being absent.
 */
const tabStop = (mark: FacetMark) => (filters(mark) && !props.tabbable ? -1 : undefined)

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
    class="facet-marks"
    :class="{ fold: props.fold }"
    :data-surface="props.surface"
  >
    <template
      v-for="mark in marks"
      :key="`${mark.facet}:${mark.value}`"
    >
      <LabelChip
        v-if="mark.form === 'chips'"
        :label="mark.value"
        :active="active(mark)"
        :filterable="props.filterable"
        :tabbable="props.tabbable"
        @filter="pressLabel"
      />
      <SemanticState
        v-else-if="mark.facet === 'state' && !mark.glyph"
        class="facet-state"
        dimension="work-item-state"
        :state="mark.value"
        :label="word(mark)"
      />
      <component
        :is="tag(mark)"
        v-else
        class="facet-mark"
        :class="{ quiet: mark.quiet, filters: filters(mark) }"
        :type="buttonType(mark)"
        :data-facet="mark.facet"
        :data-tone="semanticStatePresentation(mark.tone).tone"
        :data-active="activeMark(mark)"
        :aria-label="filterName(mark)"
        :title="hoverText(mark)"
        :tabindex="tabStop(mark)"
        @click="press(mark, $event)"
      >
        <VIcon
          v-if="mark.glyph"
          class="facet-glyph"
          :name="mark.glyph"
          :size="14"
          :stroke-width="2"
        />
        <span
          class="facet-word"
          :class="{ 'facet-word-hidden': glyphOnly(mark) }"
          >{{ word(mark) }}</span
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
