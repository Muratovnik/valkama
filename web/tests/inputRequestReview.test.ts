/**
 * A question answered row by row, by the contract's section "Questions and decisions": what the
 * web reads, what it sends and refuses, how a draft is filled and how two answers differ. The
 * expected values are the contract's own examples, not this code's output.
 */
import { describe, expect, test } from 'vitest'

import { differsFromAnswer, draftFromAnswer } from '@/features/input-requests/utils/answerChange.ts'
import { answerDiff, diffText } from '@/features/input-requests/utils/answerDiff.ts'
import type { AnswerSide, DiffRow } from '@/features/input-requests/utils/answerDiff.ts'
import {
  chooseVerdict,
  fillRecommended,
  isReview,
  isStructured,
  sections,
  shortName,
  undecidedVerdicts,
} from '@/features/input-requests/utils/reviewForm.ts'
import { checkAnswers, EMPTY_DRAFT } from '@/features/input-requests/utils/validateAnswers.ts'
import type { RequestDraft } from '@/features/input-requests/utils/validateAnswers.ts'

import { validateInputRequestDetail } from '@/shared/api/inputRequestModel.ts'
import type { InputRequestField } from '@/shared/api/inputRequestModel.ts'
import { i18n } from '@/shared/i18n/index.ts'

import { firstAnswer, requestEntry } from './support/inputRequests.ts'
import { recommendedAnswer, reviewFields } from './support/reviewQuestion.ts'

/** The contract's two points: one with its steps and one with its way under `accept`. */
const contractFields: InputRequestField[] = [
  {
    id: 'p4',
    label: 'P4 Checks: false alarms',
    type: 'verdict',
    required: false,
    options: [],
    group: 'Checks',
    recommended: 'accept',
    description: 'Fourteen refusals last week were false alarms.',
  },
  {
    id: 'p4-steps',
    label: 'Steps',
    type: 'multi_choice',
    required: true,
    under: { field: 'p4', option: 'accept' },
    options: [
      { id: 'p4a', label: 'Mark the 14 refusals, then narrow the rule', recommended: true },
      { id: 'p4b', label: 'Check the claim against the file it names', recommended: true },
      { id: 'p4c', label: 'Skip the check on an intermediate stop' },
    ],
  },
  {
    id: 'p13',
    label: 'P13 A 400-line limit for .vue files',
    type: 'verdict',
    required: false,
    options: [],
    group: 'Web code',
    recommended: 'accept',
  },
  {
    id: 'p13-way',
    label: 'How',
    type: 'choice',
    required: true,
    under: { field: 'p13', option: 'accept' },
    options: [
      { id: 'per_block', label: 'vue/max-lines-per-block', recommended: true },
      { id: 'css_file', label: 'Styles in CSS files' },
      { id: 'split_first', label: 'Split the files first' },
    ],
  },
]
const [p4, steps, p13, way] = contractFields as [
  InputRequestField,
  InputRequestField,
  InputRequestField,
  InputRequestField,
]
const draft = (change: Partial<RequestDraft>): RequestDraft => ({ ...EMPTY_DRAFT, ...change })
const many = (count: number) =>
  Array.from({ length: count }, (_, index) => ({ ...p13, id: `p${index + 1}` }))
const envelope = (fields: unknown[]) => {
  const entry = requestEntry()
  return {
    interface_version: 'valkama-planning-requests',
    ...entry,
    request: { ...entry.request, fields },
  }
}

describe('reading a question', () => {
  test('reads the contract’s review fields and the real 25-field one', () => {
    expect(validateInputRequestDetail(envelope(contractFields)).request.fields).toEqual(
      contractFields,
    )
    expect(validateInputRequestDetail(envelope(reviewFields)).request.fields).toHaveLength(25)
  })

  test('holds up to 40 fields, and not 41', () => {
    expect(validateInputRequestDetail(envelope(many(40))).request.fields).toHaveLength(40)
    expect(() => validateInputRequestDetail(envelope(many(41)))).toThrow()
  })

  test.each([
    ['options on a verdict', [{ ...p13, options: [{ id: 'a', label: 'A' }] }]],
    ['a recommendation on a choice', [{ ...way, under: undefined, recommended: 'accept' }]],
    ['a parent no earlier field is', [steps, p4]],
    ['a parent of another type', [{ ...p4, type: 'text' as const, recommended: undefined }, steps]],
    ['an option the parent lacks', [p4, { ...steps, under: { field: 'p4', option: 'maybe' } }]],
    ['more than one level', [p4, steps, { ...way, under: { field: 'p4-steps', option: 'p4a' } }]],
    ['a key a field does not take', [{ ...p13, hint: 'x' }]],
  ])('refuses %s', (_, fields) => {
    expect(() => validateInputRequestDetail(envelope(fields))).toThrow()
  })
})

describe('drawing it', () => {
  test('a question without the new keys is drawn as before; a group or nine verdicts is a review', () => {
    const plain = requestEntry().request.fields
    expect([isStructured(plain), isReview(plain)]).toEqual([false, false])
    const eight = Array.from({ length: 8 }, (_, index) => ({
      ...p13,
      id: `v${index}`,
      group: undefined,
    }))
    expect([isStructured(eight), isReview(eight)]).toEqual([true, false])
    expect(isReview([...eight, { ...p13, id: 'v9', group: undefined }])).toBe(true)
    expect(isReview(contractFields)).toBe(true)
  })

  test('sections keep a group together, with what stands under a point', () => {
    expect(sections(reviewFields).map(({ group, fields }) => [group, fields.length])).toEqual([
      ['Hooks and client mods', 3],
      ['Checks and skill texts', 2],
      ['Instructions', 5],
      ['Valkama: code', 6],
      ['Lab and small things', 2],
    ])
  })

  test('a point is named by the number its label opens with, or else by its label', () => {
    expect(shortName(p4)).toBe('P4')
    expect(shortName(way)).toBe('How')
    expect(shortName({ ...p4, label: 'P41 Another point' })).toBe('P41 Another point')
  })
})

describe('choosing a parent', () => {
  test('accepting fills the steps once with the recommended ones, and the way with its own', () => {
    let next = chooseVerdict(contractFields, EMPTY_DRAFT, p4, 'accept')
    expect(next.answers['p4-steps']).toEqual(['p4a', 'p4b'])
    next = chooseVerdict(contractFields, next, p13, 'accept')
    expect(next.answers['p13-way']).toBe('per_block')
  })

  test('with none recommended every step is filled, and a way with nothing', () => {
    const bare = contractFields.map((field) => ({
      ...field,
      options: field.options.map(({ id, label }) => ({ id, label })),
    }))
    const next = chooseVerdict(bare, chooseVerdict(bare, EMPTY_DRAFT, p4, 'accept'), p13, 'accept')
    expect(next.answers['p4-steps']).toEqual(['p4a', 'p4b', 'p4c'])
    expect(next.answers).not.toHaveProperty('p13-way')
  })

  test('another verdict hides the steps and keeps them; accepting again fills nothing anew', () => {
    const accepted = chooseVerdict(contractFields, EMPTY_DRAFT, p4, 'accept')
    const emptied = { ...accepted, answers: { ...accepted.answers, 'p4-steps': [] } }
    const later = chooseVerdict(contractFields, emptied, p4, 'later')
    expect(later.answers['p4-steps']).toEqual([])
    expect(chooseVerdict(contractFields, later, p4, 'accept').answers['p4-steps']).toEqual([])
  })

  // The owner's rule: a point's comment is its own option while it has no verdict, so it
  // counts as decided, and the note on the verdict once one is chosen.
  test('a comment with no verdict decides the point as its own option, and a verdict keeps it', () => {
    const own = draft({ comments: { p4: 'Mine' } })
    expect(undecidedVerdicts([p4, p13], own)).toEqual([p13])
    expect(checkAnswers([p4], own)).toMatchObject({ own: { p4: 'Mine' }, values: {} })
    const rejected = chooseVerdict(contractFields, own, p4, 'reject')
    expect(rejected).toMatchObject({ answers: { p4: 'reject' }, comments: { p4: 'Mine' } })
    expect(checkAnswers([p4], rejected)).toMatchObject({ own: {}, fieldNotes: { p4: 'Mine' } })
  })

  test('accepting leaves a way unfilled whose comment stands in for its choice', () => {
    const own = draft({ comments: { 'p13-way': 'Neither' } })
    expect(chooseVerdict(contractFields, own, p13, 'accept').answers).toEqual({ p13: 'accept' })
  })
})

describe('accepting what is recommended', () => {
  test('fills only what is undecided, and leaves what the person chose', () => {
    const chosen = draft({ answers: { p4: 'reject' } })
    const { draft: next, filled } = fillRecommended(contractFields, chosen)
    expect(filled).toBe(1)
    expect(next.answers).toEqual({ 'p4': 'reject', 'p13': 'accept', 'p13-way': 'per_block' })
    expect(fillRecommended(contractFields, next).filled).toBe(0)
  })

  test('on the real review it is the whole answer, every point accepted as proposed', () => {
    const { draft: next } = fillRecommended(reviewFields, EMPTY_DRAFT)
    expect(undecidedVerdicts(reviewFields, next)).toEqual([])
    expect(checkAnswers(reviewFields, next)).toMatchObject({
      refused: [],
      values: recommendedAnswer,
    })
  })
})

describe('sending', () => {
  test('a verdict is one of three words', () => {
    expect(checkAnswers([p13], draft({ answers: { p13: 'maybe' } })).refused).toEqual(['p13'])
    expect(checkAnswers([p13], draft({ answers: { p13: 'later' } })).values).toEqual({
      p13: 'later',
    })
  })

  test('a hidden field gives nothing and is never refused, even required', () => {
    const later = draft({
      answers: { 'p4': 'later', 'p4-steps': ['p4a'] },
      comments: { 'p4-steps': 'Kept' },
    })
    expect(checkAnswers(contractFields, later)).toEqual({
      fieldNotes: {},
      own: {},
      refused: [],
      values: { p4: 'later' },
    })
  })

  test('a field under another is required while it is shown', () => {
    const accepted = draft({ answers: { 'p4': 'accept', 'p4-steps': [] } })
    expect(checkAnswers(contractFields, accepted).refused).toEqual(['p4-steps'])
  })

  test('an undecided point is left out, and the answer is the contract’s flat one', () => {
    const given = draft({
      answers: {
        'p4': 'accept',
        'p4-steps': ['p4a', 'p4c'],
        'p13': 'accept',
        'p13-way': 'per_block',
      },
    })
    const { values } = checkAnswers(
      [...contractFields, { ...p13, id: 'p17', group: 'Web code' }],
      given,
    )
    expect(values).toEqual({
      'p4': 'accept',
      'p4-steps': ['p4a', 'p4c'],
      'p13': 'accept',
      'p13-way': 'per_block',
    })
  })

  test('a change that only hides a draft says nothing new', () => {
    const entry = requestEntry()
    const request = {
      ...entry.request,
      fields: contractFields,
      status: 'answered' as const,
      ...firstAnswer,
      answers: { p4: 'later' },
    }
    const form = draftFromAnswer(request)
    const reopened = chooseVerdict(
      contractFields,
      chooseVerdict(contractFields, form, p4, 'accept'),
      p4,
      'later',
    )
    expect(reopened.answers['p4-steps']).toEqual(['p4a', 'p4b'])
    expect(differsFromAnswer(request, reopened)).toBe(false)
  })
})

const offered: InputRequestField[] = [
  { id: 'p1', label: 'p1', type: 'verdict', required: false, options: [] },
  { id: 'p10', label: 'p10', type: 'verdict', required: false, options: [] },
  {
    id: 'p10-steps',
    label: 'p10-steps',
    type: 'multi_choice',
    required: true,
    under: { field: 'p10', option: 'accept' },
    options: ['glob', 'scan', 'lock'].map((id) => ({ id, label: id })),
  },
  { id: 'p12', label: 'p12', type: 'verdict', required: false, options: [] },
  { id: 'p15', label: 'p15', type: 'verdict', required: false, options: [] },
]
const side = (answers: AnswerSide['answers'], notes = {}): AnswerSide => ({
  answers,
  field_notes: notes,
  own: {},
  note: null,
})
const marked = (row: Extract<DiffRow, { part: 'options' }>) =>
  [...row.added.map((id) => `+${id}`), ...row.removed.map((id) => `−${id}`)].join(' ')
/** The contract's notation for a row, in ids as stored. */
function asStored(row: DiffRow) {
  if (row.part === 'note') return `note: ${row.text}`
  const { id } = row.field
  if (row.part === 'options') return `${id} ${marked(row)}`
  if (row.part === 'value') return `${id} ${String(row.from ?? '—')}→${String(row.to ?? '—')}`
  if (row.part === 'text') return `${id} rewritten`
  return `${id} ${row.part === 'own' ? 'own variant' : 'comment'}: ${row.text}`
}
const t = (key: string, values: Record<string, unknown> = {}) => i18n.global.t(key, values)

describe('the difference between two answers', () => {
  const before = side({
    'p1': 'accept',
    'p10': 'accept',
    'p10-steps': ['glob', 'scan'],
    'p12': 'later',
    'p15': 'reject',
  })
  const after = side(
    {
      'p1': 'accept',
      'p10': 'accept',
      'p10-steps': ['scan', 'lock'],
      'p12': 'accept',
      'p15': 'reject',
    },
    { p15: 'Frozen until spring' },
  )

  test('is the contract’s three rows, in the order of the fields', () => {
    expect(
      answerDiff(offered, before, after)
        .map((row) => asStored(row))
        .join('; '),
    ).toBe('p10-steps +lock −glob; p12 later→accept; p15 comment: Frozen until spring')
  })

  test('reads in the person’s words, with labels and verdicts', () => {
    i18n.global.locale.value = 'en'
    const lines = answerDiff(offered, before, { ...after, note: 'x'.repeat(80) }).map((row) =>
      diffText(offered, row, t),
    )
    expect(lines).toEqual([
      'p10 · p10-steps +lock −glob',
      'p12 put off → accepted',
      'p15 comment: Frozen until spring',
      `Comment on the block of questions: ${'x'.repeat(59)}…`,
    ])
    expect(diffText(offered, { field: p13, part: 'value', from: undefined, to: 'accept' }, t)).toBe(
      'P13 — → accepted',
    )
  })
})
