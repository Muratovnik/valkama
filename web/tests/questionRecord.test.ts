/**
 * Which questions of a choice their recommendation answers, and what accepting it would send;
 * and what one press of a kind's answer sends with what the form holds.
 */
import { describe, expect, it } from 'vitest'

import {
  choiceRecord,
  kindAnswerDraft,
  recommendedAnswers,
} from '@/features/input-requests/utils/questionRecord.ts'
import type { KindAnswer, QuestionRecord } from '@/features/input-requests/utils/questionRecord.ts'
import { EMPTY_DRAFT } from '@/features/input-requests/utils/validateAnswers.ts'
import type { RequestDraft } from '@/features/input-requests/utils/validateAnswers.ts'

import type { InputRequestEntry, InputRequestField } from '@/shared/api/inputRequestModel.ts'

import { requestEntry } from './support/inputRequests.ts'

const route: InputRequestField = {
  id: 'route',
  label: 'Route',
  type: 'choice',
  required: true,
  options: [
    { id: 'keep', label: 'Keep' },
    { id: 'merge', label: 'Merge', recommended: true },
  ],
}
const areas: InputRequestField = {
  id: 'areas',
  label: 'Areas',
  type: 'multi_choice',
  required: false,
  options: [
    { id: 'web', label: 'Web', recommended: true },
    { id: 'server', label: 'Server' },
    { id: 'docs', label: 'Docs', recommended: true },
  ],
}
const plain: InputRequestField = {
  id: 'plain',
  label: 'Plain',
  type: 'choice',
  required: true,
  options: [
    { id: 'a', label: 'A' },
    { id: 'b', label: 'B' },
  ],
}
const why: InputRequestField = {
  id: 'why',
  label: 'Why',
  type: 'text',
  required: true,
  options: [],
}

let next = 0
function asked(
  fields: InputRequestField[],
  change: Partial<InputRequestEntry['request']> = {},
): QuestionRecord {
  const entry = requestEntry()
  next += 1
  entry.request = {
    ...entry.request,
    request_id: `22222222-2222-4222-8222-${String(next).padStart(12, '0')}`,
    fields,
    ...change,
  }
  return choiceRecord(entry)
}
const empty = () => EMPTY_DRAFT
const answersOf = (split: ReturnType<typeof recommendedAnswers>) =>
  split.ready.map(({ draft }) => draft.answers)

describe('the questions their recommendation answers', () => {
  it('fills a choice with the option it recommends and ticks with every one recommended', () => {
    const split = recommendedAnswers([asked([route, areas])], empty)
    expect(answersOf(split)).toEqual([{ route: 'merge', areas: ['web', 'docs'] }])
    expect(split.rest).toEqual([])
  })

  it('leaves out, and counts, a question that recommends nothing', () => {
    const none = asked([plain])
    const split = recommendedAnswers([asked([route]), none], empty)
    expect(split.ready).toHaveLength(1)
    expect(split.rest).toEqual([none])
  })

  it('leaves out a question its recommendation would not answer in full', () => {
    const wants = asked([route, why])
    expect(recommendedAnswers([wants], empty)).toEqual({ ready: [], rest: [wants] })
  })

  it('keeps what the person already chose, and fills only what they did not', () => {
    const record = asked([route, areas])
    const chosen: RequestDraft = { ...EMPTY_DRAFT, answers: { route: 'keep' } }
    const split = recommendedAnswers([record], () => chosen)
    expect(answersOf(split)).toEqual([{ route: 'keep', areas: ['web', 'docs'] }])
  })

  it('leaves out a question the person already decided: nothing is left to accept', () => {
    const record = asked([route])
    const chosen: RequestDraft = { ...EMPTY_DRAFT, answers: { route: 'keep' } }
    expect(recommendedAnswers([record], () => chosen).ready).toEqual([])
  })

  it('fills a review as its own press does, and the choice an accepted point opens', () => {
    const point: InputRequestField = {
      id: 'p1',
      label: 'P1',
      type: 'verdict',
      required: true,
      options: [],
      recommended: 'accept',
    }
    const way: InputRequestField = { ...route, id: 'way', under: { field: 'p1', option: 'accept' } }
    const split = recommendedAnswers([asked([point, way])], empty)
    expect(answersOf(split)).toEqual([{ p1: 'accept', way: 'merge' }])
  })

  it('leaves out what cannot be answered from here: not waiting, or not writable', () => {
    const answered = asked([route], { status: 'declined' })
    const readonly = asked([route])
    readonly.entry.target.writable = false
    expect(recommendedAnswers([answered, readonly], empty).ready).toEqual([])
  })

  it('takes only the questions of a choice', () => {
    const other: QuestionRecord = { ...asked([route]), kind: 'goal', answers: [] }
    expect(recommendedAnswers([other], empty)).toEqual({ ready: [], rest: [] })
  })
})

describe('what one answer of a kind sends', () => {
  const answers: KindAnswer[] = [
    { label: 'Do', answer: { decision: 'do' } },
    { label: 'Later…', answer: { decision: 'later' }, later: { field: 'until' } },
  ]
  const held: RequestDraft = {
    ...EMPTY_DRAFT,
    answers: { decision: 'drop', until: '2099-01-01', ticks: ['a'] },
    note: 'a note',
  }

  it('is its own values over what the form holds, the rest of the form kept', () => {
    expect(kindAnswerDraft(answers, 1, held)).toEqual({
      ...held,
      answers: { decision: 'later', until: '2099-01-01', ticks: ['a'] },
    })
  })

  it('leaves out the day another answer would put the question off to', () => {
    expect(kindAnswerDraft(answers, 0, held).answers).toEqual({ decision: 'do', ticks: ['a'] })
  })
})
