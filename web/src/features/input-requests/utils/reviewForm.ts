import {
  choosesIn,
  commentOn,
  editField,
  isShown,
} from '@/features/input-requests/utils/validateAnswers.ts'
import type { RequestDraft } from '@/features/input-requests/utils/validateAnswers.ts'

import type { InputAnswers, InputRequestField, VERDICTS } from '@/shared/api/inputRequestModel.ts'
import { plainText } from '@/shared/lib/richText.ts'

/**
 * A question answered row by row, as a review is: one line per point, each accepted, put off or
 * rejected (`verdict`), the steps or the way of an accepted point in a field under it, and the
 * points in groups. The answer stays one flat object: a field under another is one more key.
 *
 * A question with none of that is drawn as it always was. One with a group, or with more than
 * eight verdicts, is a review in full: its answer folds to a summary and its changes read as
 * what they changed, because twenty-five fields a version do not fit on a screen.
 */
export type Verdict = (typeof VERDICTS)[number]

type Fields = readonly InputRequestField[]

/** More verdicts than this, even with no group, and the question reads as a review. */
const FEW_VERDICTS = 8

/** Drawn row by row: a verdict, a group or a field under another is in it. */
export function isStructured(fields: Fields): boolean {
  return fields.some(
    (field) => field.type === 'verdict' || field.group !== undefined || field.under !== undefined,
  )
}

/** A review in full, by the contract's rule: a group, or more than eight verdicts. */
export function isReview(fields: Fields): boolean {
  return (
    fields.some((field) => field.group !== undefined) ||
    fields.filter((field) => field.type === 'verdict').length > FEW_VERDICTS
  )
}

/** The fields under one, in their order. */
export function childrenOf(fields: Fields, parent: string): InputRequestField[] {
  return fields.filter((field) => field.under?.field === parent)
}

/** One run of fields under one heading, or under none. A field under another goes with it. */
export interface FieldSection {
  fields: InputRequestField[]
  group: string | null
}

export function sections(fields: Fields): FieldSection[] {
  const runs: FieldSection[] = []
  for (const field of fields) {
    if (field.under) continue
    const group = field.group ?? null
    const last = runs.at(-1)
    if (last && last.group === group) last.fields.push(field)
    else runs.push({ group, fields: [field] })
  }
  return runs
}

/** A verdict is decided by a word, or by a comment with none, which is sent as its own option. */
function isDecided(field: InputRequestField, draft: RequestDraft): boolean {
  return draft.answers[field.id] !== undefined || Boolean(commentOn(draft, field))
}

/** The verdicts on screen: a hidden one is neither decided nor undecided. */
export function shownVerdicts(fields: Fields, answers: InputAnswers): InputRequestField[] {
  return fields.filter((field) => field.type === 'verdict' && isShown(field, answers))
}

export function undecidedVerdicts(fields: Fields, draft: RequestDraft): InputRequestField[] {
  return shownVerdicts(fields, draft.answers).filter((field) => !isDecided(field, draft))
}

/**
 * What a field under an accepted point is filled with the first time it shows: ticks with the
 * recommended options, or every option where none is; a choice with its recommended option, or
 * nothing. A field that was ever given anything, even all its ticks taken back, keeps that, and
 * so does one whose comment stands in for a choice.
 */
function firstFill(
  child: InputRequestField,
  draft: RequestDraft,
): InputAnswers[string] | undefined {
  if (Object.hasOwn(draft.answers, child.id) || commentOn(draft, child)) return undefined
  const recommended = child.options.filter((option) => option.recommended).map(({ id }) => id)
  if (child.type === 'multi_choice')
    return recommended.length ? recommended : child.options.map(({ id }) => id)
  return child.type === 'choice' ? recommended[0] : undefined
}

/** A draft with one verdict given, and accepting fills what it opens. */
export function chooseVerdict(
  fields: Fields,
  draft: RequestDraft,
  field: InputRequestField,
  verdict: Verdict,
): RequestDraft {
  let next = editField(draft, field.id, { value: verdict })
  if (verdict !== 'accept') return next
  for (const child of childrenOf(fields, field.id)) {
    const value = child.under?.option === 'accept' ? firstFill(child, next) : undefined
    if (value !== undefined) next = editField(next, child.id, { value })
  }
  return next
}

/**
 * What a point's verdict opened, as its closed row names it: the first field with options shown
 * under it, with what is chosen there. A comment standing in for a choice is its own option;
 * nothing chosen where something is required is said as missing.
 */
export interface PointWay {
  /** The option chosen, by its label; empty while none is. */
  chosen: string
  /** The ticks, how many of how many; null for a single answer. */
  count: { chosen: number; total: number } | null
  label: string
  missing: boolean
  /** The verdict that opened it. */
  option: string
  own: boolean
  /** The option chosen is the one the agent recommends. */
  recommended: boolean
}

export function wayOf(fields: Fields, field: InputRequestField, draft: RequestDraft) {
  const way = childrenOf(fields, field.id).find(
    (child) =>
      (child.type === 'choice' || child.type === 'multi_choice') && isShown(child, draft.answers),
  )
  if (!way?.under) return null
  const value = draft.answers[way.id]
  const own = !choosesIn(draft, way.id) && Boolean(commentOn(draft, way))
  const missing = way.required && !own && !choosesIn(draft, way.id)
  const base = { label: plainText(way.label), missing, option: way.under.option, own }
  if (way.type === 'multi_choice') {
    const chosen = Array.isArray(value) ? value.length : 0
    return {
      ...base,
      chosen: '',
      count: { chosen, total: way.options.length },
      recommended: false,
    } satisfies PointWay
  }
  const option = way.options.find(({ id }) => id === value)
  return {
    ...base,
    chosen: option ? plainText(option.label) : '',
    count: null,
    recommended: Boolean(option?.recommended),
  } satisfies PointWay
}

/**
 * Every verdict still undecided given what the agent recommends, as if each were chosen by hand;
 * what the person already chose stays. Nothing is sent, and a hand undoes any of it.
 *
 * A verdict under another shows only once that one holds, and a question may list it first, so
 * the fields are gone through again while a pass fills anything: one pass left such a verdict
 * undecided. Each pass decides a verdict for good or ends it, so the passes end.
 */
export function fillRecommended(
  fields: Fields,
  draft: RequestDraft,
): { draft: RequestDraft; filled: number } {
  let done = { draft, filled: 0 }
  for (let pass = fillOnce(fields, draft); pass.filled > 0; pass = fillOnce(fields, pass.draft))
    done = { draft: pass.draft, filled: done.filled + pass.filled }
  return done
}

/** One pass of that over the fields, in their order. */
function fillOnce(fields: Fields, draft: RequestDraft) {
  let next = draft
  let filled = 0
  for (const field of fields) {
    const { recommended } = field
    if (!recommended || !isShown(field, next.answers) || isDecided(field, next)) continue
    next = chooseVerdict(fields, next, field, recommended)
    filled += 1
  }
  return { draft: next, filled }
}

/**
 * What a row is called where it is one of many: the number a point's label opens with, when it
 * opens with the field's own id (`p15` for «P15 Something»), or else the whole label.
 */
export function shortName(field: InputRequestField): string {
  const { id, label } = field
  const lead = label.slice(0, id.length)
  const next = label.charAt(id.length)
  return lead.toLowerCase() === id.toLowerCase() && !/[\p{L}\p{N}_-]/u.test(next) ? lead : label
}

/** A field under another named with its parent, so that two «Steps» are told apart. */
export function rowName(fields: Fields, field: InputRequestField): string {
  const parent = field.under && fields.find(({ id }) => id === field.under?.field)
  return parent ? `${shortName(parent)} · ${field.label}` : shortName(field)
}
