/**
 * The marks of one run as plain elements, in the registry's words.
 *
 * Which facets print, in what form and in which tone is the registry's
 * (`facets.ts`) and the state owner's (`uiSystem.ts`) to say; this draws what
 * they answer, and is the only thing that does. `FacetMarks` wraps it for a
 * surface that holds a few runs; a list row and a tile, which hold thousands
 * between them, call it from their own render and spend no component instance
 * on a run, a chip or a glyph.
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
 * A pressed mark is out of the Tab order inside a container that is one Tab
 * stop; every other mark, and a pressed one anywhere else, has the default
 * order, which is the attribute being absent.
 */
import { createCommentVNode, h } from 'vue'
import type { VNode } from 'vue'

import '@/entities/work-item/components/facetMarks.css'
import type { MarkWords } from '@/entities/work-item/composables/useMarkWords.ts'
import type { FacetMark, FacetSurface } from '@/entities/work-item/utils/facets.ts'
import { EMPTY_WORK_FILTER, hasToken } from '@/entities/work-item/utils/workFilter.ts'
import type { WorkFilter, WorkFilterToken } from '@/entities/work-item/utils/workFilter.ts'

import { semanticStatePresentation } from '@/shared/lib/uiSystem.ts'
import { iconGlyph } from '@/shared/ui/iconGlyph.ts'
import SemanticState from '@/shared/ui/SemanticState.vue'

/** How a surface places one run. */
export interface MarkRun {
  surface: FacetSurface
  words: MarkWords
  /** The filter in force, so a mark already in it offers to come out. */
  filter?: WorkFilter
  /** Kind, priority and label marks become buttons that filter. */
  filterable?: boolean
  /** Label chips keep one line: the ones with no room fold into «+N». */
  fit?: boolean
  /** The run stays on one line: short of room, a mark shows its glyph alone. */
  fold?: boolean
  /**
   * A run of one mark that stands in a cell of its own is that mark, with no
   * line around it: a list row has four, and the box around each drew nothing.
   */
  solo?: boolean
  /** False inside a container that is one Tab stop. */
  tabbable?: boolean
  onFilter?: (token: WorkFilterToken) => void
}

/** One label as a chip, as `LabelChip` and a run of marks both draw it. */
export interface ChipDrawing {
  /** The label is in the filter now. */
  active: boolean
  /** A button that filters; otherwise a plain chip. */
  filterable: boolean
  label: string
  tabbable: boolean
  words: MarkWords
  onFilter: (label: string) => void
}

/**
 * One label as a chip: a lifted face and muted ink, so it reads as a thing that
 * can be pressed rather than as a hole in the card. As a button it adds its
 * label to the filter, and takes it out again while it is in.
 *
 * The face is a lift over whatever the chip lies on rather than a grey of its
 * own: a tile, a hovered tile and a list row are three grounds, and the control
 * grey the face used to be is the hovered tile's own tone.
 *
 * `tabbable` is false where a container is one Tab stop — a board tile — and the
 * keyboard reaches the same filter through the card and the bar instead.
 */
export function drawChip(chip: ChipDrawing, extraClass = ''): VNode {
  const face = h('span', { class: 'chip-face' }, chip.label)
  if (!chip.filterable) return h('span', { class: `label-chip${extraClass}` }, [face])
  const name = chip.words.filterName('labels', chip.active, chip.label)
  return h(
    'button',
    {
      'class': `label-chip filters${extraClass}`,
      'type': 'button',
      'aria-label': name,
      'title': name,
      'data-active': chip.active || undefined,
      'tabindex': chip.tabbable ? undefined : -1,
      // The chip lies inside something that opens on a click; filtering must
      // not open it as well.
      'onClick': (event: MouseEvent) => {
        event.stopPropagation()
        chip.onFilter(chip.label)
      },
    },
    [face],
  )
}

/** What a mark draws beside its glyph: its short words, its word alone, or its word. */
function markWordsOf(mark: FacetMark, whole: string, words: MarkWords, named: boolean): VNode[] {
  if (mark.short !== undefined)
    return [
      h('span', { 'class': 'facet-word', 'aria-hidden': 'true' }, words.say(mark.short)),
      h('span', { class: 'facet-word-hidden' }, whole),
    ]
  // A word alone is a word of its own, which takes the mark's tone.
  if (mark.form === 'word') return [h('span', { class: 'facet-word facet-word-alone' }, whole)]
  const glyphOnly = mark.form === 'glyph' && mark.glyph !== null
  // A button's name is its label: a word kept out of sight would say nothing more.
  if (glyphOnly && named) return []
  return [h('span', { class: glyphOnly ? 'facet-word facet-word-hidden' : 'facet-word' }, whole)]
}

const isActive = (mark: FacetMark, run: MarkRun) =>
  mark.filter !== null && hasToken(run.filter ?? EMPTY_WORK_FILTER, mark.filter)

/** What a mark is and does, whatever it draws inside: its tone, its name, its hover and its press. */
function markProps(mark: FacetMark, run: MarkRun, whole: string, filters: boolean) {
  const { filter } = mark
  const active = isActive(mark, run)
  const name = filters ? run.words.filterName(mark.facet, active, whole) : undefined
  const glyphOnly = mark.form === 'glyph' && mark.glyph !== null
  // A glyph whose word may fold out of sight tells the pointer its word.
  const foldable = run.fold === true && mark.glyph !== null
  return {
    'key': `${mark.facet}:${mark.value}`,
    'type': filters ? 'button' : undefined,
    'data-facet': mark.facet,
    'data-tone': semanticStatePresentation(mark.tone).tone,
    'data-active': active || undefined,
    'aria-label': name,
    'title': name ?? (glyphOnly || foldable || mark.short ? whole : undefined),
    'tabindex': filters && run.tabbable === false ? -1 : undefined,
    'onClick': filter
      ? (event: MouseEvent) => {
          event.stopPropagation()
          run.onFilter?.(filter)
        }
      : undefined,
  }
}

const markShape = (mark: FacetMark, filters: boolean) =>
  `facet-mark${mark.quiet ? ' quiet' : ''}${filters ? ' filters' : ''}`

function drawMark(mark: FacetMark, run: MarkRun): VNode {
  const whole = run.words.say(mark.text)
  const filters = run.filterable === true && mark.filter !== null
  const glyph =
    mark.glyph && mark.form !== 'word'
      ? [iconGlyph(mark.glyph, { class: 'facet-glyph', size: 14, strokeWidth: 2 })]
      : []
  return h(
    filters ? 'button' : 'span',
    {
      ...markProps(mark, run, whole, filters),
      'class': `${markShape(mark, filters)}${run.solo ? ' facet-marks' : ''}`,
      'data-surface': run.solo ? run.surface : undefined,
    },
    [...glyph, ...markWordsOf(mark, whole, run.words, filters)],
  )
}

function drawEntry(mark: FacetMark, run: MarkRun): VNode {
  const key = `${mark.facet}:${mark.value}`
  if (mark.form === 'chips')
    return h(
      drawChip(
        {
          active: isActive(mark, run),
          filterable: run.filterable === true,
          label: mark.value,
          onFilter: (label) => run.onFilter?.({ facet: 'labels', value: label }),
          tabbable: run.tabbable !== false,
          words: run.words,
        },
        ' facet-chip',
      ),
      { key },
    )
  if (mark.facet === 'state' && !mark.glyph)
    return h(SemanticState, {
      key,
      class: 'facet-state',
      dimension: 'work-item-state',
      state: mark.value,
      label: run.words.say(mark.text),
    })
  return drawMark(mark, run)
}

/**
 * One word alone in a table cell, a column's priority or holder: the mark is the
 * word, with no box inside the cell. A table works out a column's width from
 * every cell in it, and a box of flex items in a cell made that the dearest thing
 * a list did.
 */
export function drawWordCell([mark]: readonly FacetMark[], run: MarkRun): VNode {
  if (!mark) return createCommentVNode()
  const whole = run.words.say(mark.text)
  const filters = run.filterable === true && mark.filter !== null
  return h(
    filters ? 'button' : 'span',
    {
      ...markProps(mark, run, whole, filters),
      class: `${markShape(mark, filters)} facet-word-alone`,
    },
    whole,
  )
}

/** The run: its marks on a line of their own, for a host to place. */
export function drawMarks(marks: readonly FacetMark[], run: MarkRun): VNode {
  const [only] = marks
  if (run.solo && only && marks.length === 1) return drawEntry(only, run)
  return h(
    'span',
    {
      'class': `facet-marks${run.fold ? ' fold' : ''}${run.fit ? ' fit' : ''}`,
      'data-surface': run.surface,
    },
    marks.map((mark) => drawEntry(mark, run)),
  )
}
