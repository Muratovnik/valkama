/**
 * A record of another item's text naming this one, as the card shows it: a quiet line that
 * says where and from which item, in both languages and for every kind of text a record
 * names; one whose item is deleted, which says so and names none; the count of records older
 * than the read brings; the line's place among the threads by time; and the history's mention
 * row, which names the same item when the record of its comment was read.
 */
import { createI18n } from 'vue-i18n'

import { describe, expect, it } from 'vitest'

import { eventWords } from '@/widgets/work-item-inspector/utils/eventWords.ts'
import {
  mentionLines,
  mentionWhere,
  olderMentions,
} from '@/widgets/work-item-inspector/utils/mentionLines.ts'
import type { MentionRecord } from '@/widgets/work-item-inspector/utils/mentionLines.ts'
import { amongThreads, threadGroups } from '@/widgets/work-item-inspector/utils/threadRows.ts'

import type { WorkItem } from '@/shared/api/planningModel.ts'
import { messages, pluralRules } from '@/shared/i18n/index.ts'

import { requestEntry } from '../support/inputRequests.ts'
import { asRoot } from '../support/threads.ts'

type Locale = 'en' | 'ru'

const translate = (locale: Locale) =>
  createI18n({ legacy: false, locale, messages, pluralRules }).global.t

const at = (hour: number) => `2026-08-13T${String(hour).padStart(2, '0')}:00:00Z`

const record = (change: Partial<MentionRecord> = {}): MentionRecord => ({
  in: 'comment',
  comment_id: 41,
  from: 'MAIN-265',
  at: at(10),
  by_person: false,
  author: 'kolo (session 019a2b3c-4d5e)',
  quote: 'MAIN-264 decides what the **export** keeps.',
  ...change,
})

const waiting = () => {
  const entry = requestEntry()
  entry.request = { ...entry.request, request_id: 'q', created_at: at(1), status: 'pending' }
  return entry
}

const keys = (rows: { key: string }[]) => rows.map((row) => row.key)

const say = (locale: Locale, detail: string, mentions: readonly MentionRecord[]) =>
  eventWords(
    { action: 'mentioned', detail },
    { comments: [], t: translate(locale), questions: [], mentions },
  )

describe('mentionLines', () => {
  it.each([
    ['en', 'comment', 'Mentioned in a comment on MAIN-265'],
    ['en', 'report', 'Mentioned in a work report on MAIN-265'],
    ['en', 'summary', 'Mentioned in the task outcome of MAIN-265'],
    ['en', 'description', 'Mentioned in the description of MAIN-265'],
    ['ru', 'comment', 'Упомянута в комментарии MAIN-265'],
    ['ru', 'report', 'Упомянута в отчёте о работе MAIN-265'],
    ['ru', 'summary', 'Упомянута в итоге задачи MAIN-265'],
    ['ru', 'description', 'Упомянута в описании MAIN-265'],
  ] as const)('%s: a record in a %s says where and names its item', (locale, place, words) => {
    const [line] = mentionLines([
      record({ in: place, comment_id: place === 'description' ? null : 41 }),
    ])
    expect(line.place).toBe(place)
    expect(line.from).toBe('MAIN-265')
    expect(mentionWhere(line, translate(locale))).toBe(words)
  })

  it.each([
    ['en', 'Mentioned in a deleted work item'],
    ['ru', 'Упомянута в удалённой задаче'],
  ] as const)(
    '%s: a record whose item is deleted names none and quotes nothing',
    (locale, words) => {
      const [line] = mentionLines([record({ in: 'report', from: null, quote: null })])
      expect(line).toMatchObject({ place: 'deleted', from: null, quote: '' })
      expect(mentionWhere(line, translate(locale))).toBe(words)
    },
  )

  it('quotes the words without their markup, and keeps who wrote them', () => {
    const [agent, person] = mentionLines([
      record(),
      record({ comment_id: 42, by_person: true, author: 'user' }),
    ])
    expect(agent).toMatchObject({
      quote: 'MAIN-264 decides what the export keeps.',
      author: 'kolo (session 019a2b3c-4d5e)',
      byPerson: false,
      at: at(10),
    })
    expect(person.byPerson).toBe(true)
    // A record from before calls were recorded is no person's.
    expect(mentionLines([record({ by_person: null })])[0].byPerson).toBe(false)
  })

  it('gives every record a key of its own, a description saved twice at one time included', () => {
    const twice = record({ in: 'description', comment_id: null })
    const keys = mentionLines([twice, twice, record(), record({ comment_id: 42 })]).map(
      (line) => line.key,
    )
    expect(new Set(keys).size).toBe(4)
  })
})

describe('olderMentions', () => {
  it.each([
    [{ mentions: [record(), record({ comment_id: 42 })], mentions_total: 5 }, 3],
    [{ mentions: [record()], mentions_total: 1 }, 0],
    // A read that brings none of the fields has none to leave out.
    [{}, 0],
    [{ mentions: [record()] }, 0],
  ])('counts what the read left out of %j', (item, older) => {
    expect(olderMentions(item)).toBe(older)
  })

  it.each([
    ['en', 1, '1 older mention not shown'],
    ['en', 3, '3 older mentions not shown'],
    ['ru', 1, 'Ещё 1 более раннее упоминание не показано'],
    ['ru', 3, 'Ещё 3 более ранних упоминания не показаны'],
    ['ru', 5, 'Ещё 5 более ранних упоминаний не показаны'],
  ] as const)('%s: says %i older ones are not shown', (locale, count, words) => {
    expect(translate(locale)('mentions.older', count)).toBe(words)
  })
})

describe('amongThreads', () => {
  type Row = WorkItem['comments'][number]
  const root = (id: number, hour: number) =>
    ({
      id,
      author: 'elko',
      at: at(hour),
      kind: 'comment',
      ...asRoot,
      report: null,
      body: `root ${id}`,
    }) as Row

  it('stands each line between the threads its time falls between, under what waits', () => {
    // Threads as the discussion orders them: the waiting question, then the newest first.
    const ordered = threadGroups([root(3, 13), root(2, 11), root(1, 9)], [waiting()])
    const rows = [ordered[3], ordered[0], ordered[1], ordered[2]]
    const lines = mentionLines([
      record({ comment_id: 41, at: at(10) }),
      record({ comment_id: 42, at: at(12) }),
      record({ comment_id: 43, at: at(14) }),
      record({ comment_id: 44, at: 'not a time' }),
    ])
    const [ten, twelve, two, untimed] = keys(lines)
    expect(keys(amongThreads(rows, lines, new Set(), new Map()))).toEqual([
      'question-q',
      two,
      'comment-3',
      twelve,
      'comment-2',
      ten,
      'comment-1',
      untimed,
    ])
  })

  it('leaves a thread over a line of its own time, and reads a thread by its kept place', () => {
    const [thread] = threadGroups([root(1, 9)], [])
    const [line] = mentionLines([record({ at: at(9) })])
    expect(keys(amongThreads([thread], [line], new Set(), new Map()))).toEqual([
      'comment-1',
      line.key,
    ])
    // A reply came in at 11 while the card was open: the thread keeps its place at 9.
    const kept = new Map([['comment-1', { id: 1, time: Date.parse(at(9)) }]])
    const [later] = mentionLines([record({ at: at(10) })])
    expect(keys(amongThreads([thread], [later], new Set(), kept))).toEqual([later.key, 'comment-1'])
  })

  it('draws no line where there is no record, leaving the threads as they were', () => {
    const rows = threadGroups([root(2, 11), root(1, 9)], [])
    expect(amongThreads(rows, [], new Set(), new Map())).toEqual(rows)
  })
})

describe('the history names the item that mentioned this one', () => {
  const read = [
    record({ comment_id: 41 }),
    record({ in: 'report', comment_id: 42 }),
    record({ in: 'summary', comment_id: 43, from: 'MAIN-7' }),
    record({ comment_id: 44, from: null, quote: null }),
  ]

  it.each([
    ['en', '41', 'In a comment on MAIN-265'],
    ['ru', '41', 'В комментарии MAIN-265'],
    ['en', '42', 'In a work report on MAIN-265'],
    ['ru', '42', 'В отчёте о работе MAIN-265'],
    ['en', '43', 'In the task outcome of MAIN-7'],
    ['ru', '43', 'В итоге задачи MAIN-7'],
    ['en', '44', 'In a work item since deleted'],
    ['ru', '44', 'В задаче, которой больше нет'],
  ] as const)('%s: comment %s', (locale, detail, words) => {
    expect(say(locale, detail, read)).toBe(words)
  })

  it.each([
    // Older than the records the read brought.
    ['12', read],
    // A description, recorded by its item's id, which no record carries.
    ['description:00000000-0000-4000-8000-000000000265', read],
    // A card read with no records.
    ['41', []],
  ] as const)('keeps the bare title for %s', (detail, mentions) => {
    expect(say('en', detail, mentions)).toBe('')
  })
})
