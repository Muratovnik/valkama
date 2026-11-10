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
 * A mark with short words draws them and keeps its whole words as the name, and
 * as the hover text once the line has folded them: a tile shows «⛔ MAIN-12» and
 * says «Ждёт MAIN-12». A hover never repeats the words a mark shows.
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
import { createCommentVNode, h, withDirectives } from 'vue'
import type { FunctionalComponent, VNode, VNodeArrayChildren } from 'vue'

import '@/entities/work-item/components/facetMarks.css'
import type { MarkWords } from '@/entities/work-item/composables/useMarkWords.ts'
import type { FacetMark, FacetSurface } from '@/entities/work-item/utils/facets.ts'
import { EMPTY_WORK_FILTER, hasToken } from '@/entities/work-item/utils/workFilter.ts'
import type { WorkFilter, WorkFilterToken } from '@/entities/work-item/utils/workFilter.ts'

import { semanticStatePresentation } from '@/shared/lib/uiSystem.ts'
import { iconGlyph } from '@/shared/ui/iconGlyph.ts'
import SemanticState from '@/shared/ui/SemanticState.vue'
import { vTooltip } from '@/shared/ui/tooltipAnchors.ts'
import type { TooltipKind } from '@/shared/ui/tooltipAnchors.ts'

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

/** What a mark says on hover, and which kind of hint that is (`tooltipAnchors.ts`). */
interface MarkHint {
  kind: TooltipKind
  text: string
  /** A detail's element's own words, said whole first while they are cut. */
  words?: string
}

/** The element with its hover text in the window's one tooltip, when it has one. */
function hinted(node: VNode, hint: MarkHint | undefined): VNode {
  if (!hint) return node
  if (hint.kind === 'detail')
    return withDirectives(node, [
      [vTooltip, { text: hint.text, words: hint.words }, undefined, { detail: true }],
    ])
  if (hint.kind === 'clipped')
    return withDirectives(node, [[vTooltip, hint.text, undefined, { clipped: true }]])
  return withDirectives(node, [[vTooltip, hint.text, undefined, { name: true }]])
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
  const face = h('span', { class: 'chip-face one-line' }, chip.label)
  // Its word is on screen and its name is the button's, so the chip says its word only while
  // a narrow place cuts it.
  const whole: MarkHint = { kind: 'clipped', text: chip.label }
  if (!chip.filterable)
    return hinted(h('span', { class: `label-chip${extraClass}` }, [face]), whole)
  const name = chip.words.filterName('labels', chip.active, chip.label)
  const button = h(
    'button',
    {
      'class': `label-chip filters${extraClass}`,
      'type': 'button',
      'aria-label': name,
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
  return hinted(button, whole)
}

/**
 * A surface whose lines centre a mark against a state's word — the card and the hover
 * card — trims a mark's word and its glyph's line to their letters, as the state trims
 * its own, so all of them centre on the same middle and stand on one baseline. Other
 * surfaces line a mark up by its baseline or beside marks alone, and keep the box.
 */
const trims = (surface: FacetSurface) => surface === 'card' || surface === 'preview'
/**
 * A word keeps to one line and ends in an ellipsis short of room (`.one-line`), save in the
 * hover card, where an item is read in full and a long word wraps under its glyph.
 */
const wordClass = (surface: FacetSurface) => {
  if (surface === 'preview') return 'facet-word trimmed-word'
  return trims(surface) ? 'facet-word trimmed-word one-line' : 'facet-word one-line'
}

/** What a mark draws beside its glyph: its short words, its word alone, or its word. */
function markWordsOf(mark: FacetMark, whole: string, run: MarkRun, named: boolean): VNode[] {
  const word = wordClass(run.surface)
  if (mark.short !== undefined)
    return [
      h('span', { 'class': word, 'aria-hidden': 'true' }, run.words.say(mark.short)),
      // The shared copy for assistive technology, which a hint does not count as cut text.
      h('span', { class: 'facet-word-hidden visually-hidden' }, whole),
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

/**
 * What a mark says on hover, never the words it shows: a glyph alone is named by its word
 * (or by what its press does), a word that is cut short of room, folds out of sight or stands
 * shortened says its whole words while it is cut, and what a value means — a priority's — is
 * said beside the word on screen, after the word itself while that is cut. A mark whose word
 * stands whole has nothing to say. A preview is the tooltip's own content, where words wrap
 * rather than end in an ellipsis, and brings no hover text of its own.
 *
 * `ownLine` is false for a word in a table cell, which the cell cuts rather than the word, so
 * the cell carries the hint.
 */
function markHint(
  mark: FacetMark,
  run: MarkRun,
  { filters, ownLine = true, whole }: { filters: boolean; whole: string; ownLine?: boolean },
): MarkHint | undefined {
  const glyphOnly = mark.form === 'glyph' && mark.glyph !== null
  const name = filters ? run.words.filterName(mark.facet, isActive(mark, run), whole) : whole
  // A word on screen that its own line can end in an ellipsis.
  const cuttable = ownLine && !glyphOnly && run.surface !== 'preview'
  if (mark.hint !== undefined && run.surface !== 'preview') {
    const meaning = run.words.say(mark.hint)
    return glyphOnly
      ? {
          kind: 'detail',
          text: run.words.say({ key: 'priorityMeaning.hint', params: { priority: name, meaning } }),
        }
      : { kind: 'detail', text: meaning, words: cuttable ? whole : undefined }
  }
  if (glyphOnly) return { kind: 'name', text: name }
  // A glyph whose word may fold out of sight tells the pointer its word once it has.
  const foldable = run.fold === true && mark.glyph !== null
  return foldable || mark.short !== undefined || cuttable
    ? { kind: 'clipped', text: whole }
    : undefined
}

/** What a mark is and does, whatever it draws inside: its tone, its name and its press. */
function markProps(mark: FacetMark, run: MarkRun, whole: string, filters: boolean) {
  const { filter } = mark
  const active = isActive(mark, run)
  const name = filters ? run.words.filterName(mark.facet, active, whole) : undefined
  return {
    'key': `${mark.facet}:${mark.value}`,
    'type': filters ? 'button' : undefined,
    'data-facet': mark.facet,
    'data-tone': semanticStatePresentation(mark.tone).tone,
    'data-kind': mark.ink,
    'data-active': active || undefined,
    'aria-label': name,
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
 * What an executor's session is doing, after its client's glyph and in its line, as the side
 * panel draws it (`NavWorkRow`): three dots that run while it works on the item, held still
 * while it works on others, and a ring while it waits for a person. The mark's words say it.
 */
function drawSession(mark: FacetMark): VNode[] {
  if (!mark.session) return []
  if (mark.session === 'waiting')
    return [iconGlyph('live-waiting', { class: 'facet-session', size: 10, strokeWidth: 2.4 })]
  const still = mark.session === 'held' ? ' still' : ''
  return [
    h('span', { 'class': `facet-session work-dots${still}`, 'aria-hidden': 'true' }, [
      h('i'),
      h('i'),
      h('i'),
    ]),
  ]
}

/**
 * The glyph in a line of its own: the box is a line of the surface's text — trimmed
 * to its letters where the surface trims its words — and the glyph is centred on
 * that line's letters, so the box lines up with a word by baseline and the glyph
 * stands on the word's middle, on one line or the first of several. A glyph alone
 * is centred so in the mark's own line, with no box. A session's sign follows the
 * glyph in that line, so it stands on the same middle.
 */
function drawGlyph(mark: FacetMark, run: MarkRun, alone: boolean): VNode[] {
  if (!mark.glyph || mark.form === 'word') return []
  const glyph = iconGlyph(mark.glyph, { class: 'facet-glyph', size: 14, strokeWidth: 2 })
  const line = [glyph, ...drawSession(mark)]
  if (alone) return line
  const box = trims(run.surface) ? 'facet-glyph-box trimmed-word' : 'facet-glyph-box'
  return [h('span', { 'class': box, 'aria-hidden': 'true' }, line)]
}

function drawMark(mark: FacetMark, run: MarkRun): VNode {
  const whole = run.words.say(mark.text)
  const filters = run.filterable === true && mark.filter !== null
  const alone = isGlyphAlone(mark, run, filters)
  const glyph = drawGlyph(mark, run, alone)
  return hinted(
    h(
      filters ? 'button' : 'span',
      {
        ...markProps(mark, run, whole, filters),
        'class': `${markShape(mark, filters, alone)}${run.solo ? ' facet-marks' : ''}`,
        'data-surface': run.solo ? run.surface : undefined,
        'data-session': mark.session,
      },
      [...glyph, ...markWordsOf(mark, whole, run, filters)],
    ),
    markHint(mark, run, { filters, whole }),
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
  return hinted(
    h(
      filters ? 'button' : 'span',
      {
        ...markProps(mark, run, whole, filters),
        class: `${markShape(mark, filters)} facet-word-alone`,
      },
      whole,
    ),
    markHint(mark, run, { filters, ownLine: false, whole }),
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
      inPreview: run.surface === 'preview',
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
