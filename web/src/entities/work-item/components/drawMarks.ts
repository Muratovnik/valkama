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
 * kind has no tone: both its glyph and its word take the kind's own colour. A
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
 *
 * A glyph stands on the middle of the lowercase letters of the line it is on, on
 * every surface, by one rule: it is drawn in a box that is a line of text of its
 * own (`facet-glyph-box`, or the mark itself when the glyph is all it shows), centred on that line's letters as an inline image is
 * (`vertical-align: middle`), and the box lines up with the word beside it by
 * their shared baseline. Each surface used to centre its glyphs its own way — the
 * hover card on the first baseline, which stood a glyph on the baseline 2px above
 * its word's middle, the card on the trimmed word, the tile on the box — and a fix
 * in one never reached the others.
 *
 * The head of a work item — its kind, its number, then the rest of its run — is
 * `drawHead`, and `MarkHead` for a template: the host draws the number, a word or
 * a control of its own, and hands it in; where it stands is the registry's order.
 */
import { createCommentVNode, h } from 'vue'
import type { FunctionalComponent, VNode, VNodeArrayChildren } from 'vue'

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
  /**
   * A head's marks are said elsewhere — a hover card's are its reference's
   * description — so they are hidden from assistive technology; the number the
   * host hands in is not.
   */
  unspoken?: boolean
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

/**
 * A surface whose lines centre a mark against a state's word — the card and the hover
 * card — trims a mark's word and its glyph's line to their letters, as the state trims
 * its own, so all of them centre on the same middle and stand on one baseline. Other
 * surfaces line a mark up by its baseline or beside marks alone, and keep the box.
 */
const trims = (surface: FacetSurface) => surface === 'card' || surface === 'preview'
const wordClass = (surface: FacetSurface) =>
  trims(surface) ? 'facet-word trimmed-word' : 'facet-word'

/** What a mark draws beside its glyph: its short words, its word alone, or its word. */
function markWordsOf(mark: FacetMark, whole: string, run: MarkRun, named: boolean): VNode[] {
  const word = wordClass(run.surface)
  if (mark.short !== undefined)
    return [
      h('span', { 'class': word, 'aria-hidden': 'true' }, run.words.say(mark.short)),
      h('span', { class: 'facet-word-hidden' }, whole),
    ]
  // A word alone is a word of its own, which takes the mark's tone.
  if (mark.form === 'word') return [h('span', { class: `${word} facet-word-alone` }, whole)]
  const glyphOnly = mark.form === 'glyph' && mark.glyph !== null
  // A button's name is its label: a word kept out of sight would say nothing more.
  if (glyphOnly && named) return []
  return [h('span', { class: glyphOnly ? 'facet-word facet-word-hidden' : word }, whole)]
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
  const hover = name ?? (glyphOnly || foldable || mark.short ? whole : undefined)
  return {
    'key': `${mark.facet}:${mark.value}`,
    'type': filters ? 'button' : undefined,
    'data-facet': mark.facet,
    'data-tone': semanticStatePresentation(mark.tone).tone,
    'data-kind': mark.ink,
    'data-active': active || undefined,
    'aria-label': name,
    // What a value means follows the name the hover already gives it. A preview
    // is the tooltip's own content and brings no hover text of its own.
    'title':
      mark.hint === undefined || run.surface === 'preview'
        ? hover
        : run.words.say({
            key: 'priorityMeaning.hint',
            params: { priority: hover ?? whole, meaning: run.words.say(mark.hint) },
          }),
    'tabindex': filters && run.tabbable === false ? -1 : undefined,
    'onClick': filter
      ? (event: MouseEvent) => {
          event.stopPropagation()
          run.onFilter?.(filter)
        }
      : undefined,
  }
}

/**
 * A glyph with no word on screen beside it, not a button, on a surface that keeps
 * its lines' boxes: the mark itself is the glyph's line (`.glyph-alone`) and spends
 * no box inside it. A tile draws three of them, a hundred tiles at a time.
 */
const isGlyphAlone = (mark: FacetMark, run: MarkRun, filters: boolean) =>
  mark.form === 'glyph' && mark.glyph !== null && !filters && !trims(run.surface)

const markShape = (mark: FacetMark, filters: boolean, alone = false) =>
  `facet-mark${mark.quiet ? ' quiet' : ''}${filters ? ' filters' : ''}${alone ? ' glyph-alone' : ''}`

/**
 * The glyph in a line of its own: the box is a line of the surface's text — trimmed
 * to its letters where the surface trims its words — and the glyph is centred on
 * that line's letters, so the box lines up with a word by baseline and the glyph
 * stands on the word's middle, on one line or the first of several. A glyph alone
 * is centred so in the mark's own line, with no box.
 */
function drawGlyph(mark: FacetMark, run: MarkRun, alone: boolean): VNode[] {
  if (!mark.glyph || mark.form === 'word') return []
  const glyph = iconGlyph(mark.glyph, { class: 'facet-glyph', size: 14, strokeWidth: 2 })
  if (alone) return [glyph]
  const box = trims(run.surface) ? 'facet-glyph-box trimmed-word' : 'facet-glyph-box'
  return [h('span', { 'class': box, 'aria-hidden': 'true' }, [glyph])]
}

function drawMark(mark: FacetMark, run: MarkRun): VNode {
  const whole = run.words.say(mark.text)
  const filters = run.filterable === true && mark.filter !== null
  const alone = isGlyphAlone(mark, run, filters)
  const glyph = drawGlyph(mark, run, alone)
  return h(
    filters ? 'button' : 'span',
    {
      ...markProps(mark, run, whole, filters),
      'class': `${markShape(mark, filters, alone)}${run.solo ? ' facet-marks' : ''}`,
      'data-surface': run.solo ? run.surface : undefined,
    },
    [...glyph, ...markWordsOf(mark, whole, run, filters)],
  )
}

/**
 * One word alone in a table cell, a column's priority or holder: the mark is the
 * word, with no box inside the cell. A table works out a column's width from
 * every cell in it, and a box of flex items in a cell made that the dearest thing
 * a list did. The «+N» after a run of labels is the same word: a tile draws it a
 * hundred times, and the box around it held nothing else.
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
  if (mark.facet === 'labels') return drawWordCell([mark], run)
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

const runClass = (run: MarkRun) => `facet-marks${run.fold ? ' fold' : ''}${run.fit ? ' fit' : ''}`

/** The run: its marks on a line of their own, for a host to place. */
export function drawMarks(marks: readonly FacetMark[], run: MarkRun): VNode {
  const [only] = marks
  return run.solo && only && marks.length === 1
    ? drawEntry(only, run)
    : h(
        'span',
        { 'class': runClass(run), 'data-surface': run.surface },
        marks.map((mark) => drawEntry(mark, run)),
      )
}

/**
 * A work item's head: its kind, then its number, which the host draws and hands
 * in, then the rest of the run in the registry's order. Every surface that names
 * an item with its marks draws it here, so the number stands after the kind and
 * before everything else wherever it is read.
 */
export function drawHead(
  marks: readonly FacetMark[],
  run: MarkRun,
  reference: VNodeArrayChildren,
): VNode {
  const part = (facets: readonly FacetMark[]) => {
    const drawn = facets.map((mark) => drawEntry(mark, run))
    return run.unspoken && drawn.length
      ? [h('span', { 'class': 'facet-head-part', 'aria-hidden': 'true' }, drawn)]
      : drawn
  }
  return h('span', { 'class': `${runClass(run)} facet-head`, 'data-surface': run.surface }, [
    ...part(marks.filter((mark) => mark.facet === 'kind')),
    ...reference,
    ...part(marks.filter((mark) => mark.facet !== 'kind')),
  ])
}

/**
 * `drawHead` for a template, where the number is the default slot: a host's own
 * word or control, written in the host's template and styled by it. It is still a
 * component instance, so a host drawn a hundred times at once, a tile, calls
 * `drawHead` itself.
 */
export const MarkHead: FunctionalComponent<{ marks: readonly FacetMark[]; run: MarkRun }> = (
  props,
  { slots },
) => drawHead(props.marks, props.run, slots.default?.() ?? [])
MarkHead.props = ['marks', 'run']
