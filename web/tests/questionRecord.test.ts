/**
 * Which questions of a choice their recommendation answers, and what accepting it would send;
 * what one press of a kind's answer sends with what the form holds; and, for a group of
 * findings, which findings go and what the answer that takes them on says.
 */
import { describe, expect, it } from 'vitest'

import {
  answersOver,
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

const counted = (label: string, count: number) => `${label}: ${count}`

describe('the answers of a group of findings', () => {
  const ticks = { field: 'items', initial: ['main-1', 'main-2', 'main-3'], total: 3 }
  const group: KindAnswer[] = [
    { label: 'Do', answer: { answer: 'do' }, ticks, counts: true, needsTicked: true },
    {
      label: 'Later…',
      answer: { answer: 'later' },
      ticks,
      later: { field: 'until' },
      needsTicked: true,
    },
    { label: 'Don’t do', answer: { answer: 'drop' }, ticks, cancels: { field: 'cancels' } },
  ]
  const UNTICKED = 'Tick a finding first'
  const unticked: RequestDraft = { ...EMPTY_DRAFT, answers: { items: ['main-1', 'main-3'] } }

  it('send every finding while none was unticked, and only the ticked ones after', () => {
    expect(kindAnswerDraft(group, 0, EMPTY_DRAFT).answers).toEqual({
      answer: 'do',
      items: ['main-1', 'main-2', 'main-3'],
    })
    expect(kindAnswerDraft(group, 0, unticked).answers).toEqual({
      answer: 'do',
      items: ['main-1', 'main-3'],
    })
    expect(kindAnswerDraft(group, 1, unticked).answers.items).toEqual(['main-1', 'main-3'])
  })

  it('send none when every finding was unticked, rather than ticking them all again', () => {
    const none: RequestDraft = { ...EMPTY_DRAFT, answers: { items: [] } }
    expect(kindAnswerDraft(group, 2, none).answers).toEqual({ answer: 'drop', items: [] })
  })

  it('send a refused list’s token only with the answer that cancels', () => {
    expect(kindAnswerDraft(group, 2, EMPTY_DRAFT, 'token-b').answers.cancels).toBe('token-b')
    expect(kindAnswerDraft(group, 0, EMPTY_DRAFT, 'token-b').answers).not.toHaveProperty('cancels')
    expect(kindAnswerDraft(group, 2, EMPTY_DRAFT).answers).not.toHaveProperty('cancels')
  })

  it('name how many go on Do once a finding is unticked, and on no other answer', () => {
    expect(answersOver(group, EMPTY_DRAFT, counted, UNTICKED).map(({ label }) => label)).toEqual([
      'Do',
      'Later…',
      'Don’t do',
    ])
    expect(answersOver(group, unticked, counted, UNTICKED).map(({ label }) => label)).toEqual([
      'Do: 2',
      'Later…',
      'Don’t do',
    ])
  })

  it('block every answer that needs a tick while none is, for the reason given, and no other', () => {
    const none: RequestDraft = { ...EMPTY_DRAFT, answers: { items: [] } }
    expect(answersOver(group, none, counted, UNTICKED).map(({ blocked }) => blocked)).toEqual([
      UNTICKED,
      UNTICKED,
      undefined,
    ])
    for (const draft of [EMPTY_DRAFT, unticked])
      expect(answersOver(group, draft, counted, UNTICKED).map(({ blocked }) => blocked)).toEqual([
        undefined,
        undefined,
        undefined,
      ])
  })
})
