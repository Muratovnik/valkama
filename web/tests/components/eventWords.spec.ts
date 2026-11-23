/**
 * The history in words: a mark names its thread and its decision, a link reads from this
 * task's side, a question's id stays in the record without standing in the row, and a
 * transition names its state as every other place does, through the card's workflow.
 */
import { createI18n } from 'vue-i18n'

import { describe, expect, it } from 'vitest'

import { eventWords, stateNamer } from '@/widgets/work-item-inspector/utils/eventWords.ts'

import { EVENT_ACTIONS } from '@/shared/api/planningEventActions.ts'
import { messages, pluralRules } from '@/shared/i18n/index.ts'
import { stateName } from '@/shared/lib/stateNames.ts'
import type { StateNaming } from '@/shared/lib/stateNames.ts'

import converted from '../fixtures/server/card-converted.json'
import deferred from '../fixtures/server/card-deferred.json'
import returned from '../fixtures/server/card-returned.json'
import { requestEntry } from '../support/inputRequests.ts'
import { root } from '../support/threadCard.ts'

const [convertedCard, deferredCard, returnedCard] = [converted, deferred, returned].map(
  (answer) => answer.state.payload.work_item,
)

const comments = [
  root(5436, { body: 'Should the **second** report replace the first or stand beside it?' }),
]
const asked = requestEntry()
const questions = [
  { ...asked, request: { ...asked.request, request_id: '66666666-6666-4666-8666-666666666662' } },
]

function say(locale: 'en' | 'ru', action: string, detail: string) {
  const { t } = createI18n({ legacy: false, locale, messages, pluralRules }).global
  return eventWords({ action, detail }, { comments, t, questions })
}

describe('eventWords', () => {
  it.each([
    [
      'en',
      'comment_resolved',
      '5436: postponed',
      'Thread “Should the second report replace the first or stand beside…” · decision: postponed',
    ],
    [
      'ru',
      'comment_resolved',
      '5436: отложено: до релиза',
      'Ветка «Should the second report replace the first or stand beside…» · решение: отложено: до релиза',
    ],
    [
      'ru',
      'comment_resolved',
      '5436',
      'Ветка «Should the second report replace the first or stand beside…»',
    ],
    [
      'en',
      'comment_reopened',
      '5436',
      'Thread “Should the second report replace the first or stand beside…”',
    ],
    ['ru', 'comment_reopened', '77', 'Ветка, которой больше нет в этой задаче'],
    ['en', 'linked', 'discovered-from MAIN-7', 'Discovered from MAIN-7'],
    ['ru', 'linked', 'discovered-from from MAIN-7', 'Привело к MAIN-7'],
    ['ru', 'unlinked', 'blocks from MAIN-8', 'Заблокировано MAIN-8'],
    ['en', 'request_created', '66666666-6666-4666-8666-666666666661', ''],
    ['en', 'request_answered', '66666666-6666-4666-8666-666666666661', ''],
    // A mention keeps the id of the other item's comment in the record, not in the row.
    ['en', 'mentioned', '12', ''],
    // A question the card has read is named by its title, which the row lacked.
    [
      'en',
      'request_created',
      '66666666-6666-4666-8666-666666666662',
      'Question “Confirm deployment”',
    ],
    [
      'ru',
      'request_answered',
      '66666666-6666-4666-8666-666666666662',
      'Вопрос «Confirm deployment»',
    ],
    [
      'ru',
      'request_changed',
      '66666666-6666-4666-8666-666666666662',
      'Вопрос «Confirm deployment»',
    ],
  ] as const)('words %s %s «%s»', (locale, action, detail, words) => {
    expect(say(locale, action, detail)).toBe(words)
  })

  it.each([
    ['en', { from: ['bug', 'triage'], to: ['bug', 'triage', 'ux'] }, 'Added: “ux”'],
    ['ru', { from: ['bug', 'triage'], to: ['triage'] }, 'Снято: «bug»'],
    // A label may hold a comma: each is quoted, so the list still reads one label at a time.
    [
      'en',
      { from: ['bug', 'a, b'], to: ['bug', 'next', 'later'] },
      'Added: “next”, “later” · Removed: “a, b”',
    ],
    ['ru', { from: ['старое'], to: ['новое'] }, 'Добавлено: «новое» · Снято: «старое»'],
  ] as const)('a change of labels in %s says which came and which went', (locale, sets, words) => {
    expect(say(locale, 'labels_changed', JSON.stringify(sets))).toBe(words)
  })

  it('keeps a change of labels it cannot read as recorded', () => {
    for (const detail of ['not json', '{"from":["a"]}', '{"from":[1],"to":[]}', 'null']) {
      expect(say('en', 'labels_changed', detail)).toBe(detail)
    }
  })

  it('leaves a line of an unknown shape, and every other event, as it was recorded', () => {
    expect(say('en', 'linked', 'parent of MAIN-7')).toBe('parent of MAIN-7')
    expect(say('en', 'comment_resolved', 'not a number')).toBe('not a number')
    // With no workflow to read the key against, a transition stays as recorded.
    expect(say('en', 'transitioned', 'dev: started')).toBe('dev: started')
  })
})

/** A workflow's states by key: two standard, one renamed and one of the space's own. */
const STATES = [
  { key: 'dev', name: 'Dev', category: 'active' },
  { key: 'review', name: 'Code review', category: 'review' },
  { key: 'done', name: 'Done', category: 'completed' },
  { key: 'waiting', name: 'Ожидает внешнего подтверждения', category: 'blocked' },
]

/** A day as the reader reads it, fixed so a line's words are what is checked. */
const day = (value: string) => `[${value}]`

function move(
  locale: 'en' | 'ru',
  detail: string,
  naming: StateNaming = 'translated',
  states: typeof STATES | undefined = STATES,
) {
  const { t } = createI18n({ legacy: false, locale, messages, pluralRules }).global
  const nameState = stateNamer(states, (state) => stateName(state, naming, (message) => t(message)))
  return eventWords({ action: 'transitioned', detail }, { comments: [], t, nameState, day })
}

describe('a transition in the history', () => {
  it.each([
    ['ru', 'dev', 'В работе'],
    ['en', 'dev', 'In progress'],
    ['ru', 'done: closed by the release', 'Выполнено: closed by the release'],
    // A reason may hold a colon of its own: only the first one ends the key.
    ['en', 'dev: requeued: lease expired', 'In progress: requeued: lease expired'],
    // A renamed state and a state of the space's own read as the workflow writes them.
    ['ru', 'review', 'Code review'],
    ['en', 'waiting: asked the vendor', 'Ожидает внешнего подтверждения: asked the vendor'],
  ] as const)('%s «%s» reads «%s»', (locale, detail, words) => {
    expect(move(locale, detail)).toBe(words)
  })

  it('names every state as written when the owner chose the workflow’s words', () => {
    expect(move('ru', 'dev: started', 'workflow')).toBe('Dev: started')
  })

  it('keeps a key no state is named by, and a line of another shape, as recorded', () => {
    expect(move('ru', 'gone: moved')).toBe('gone: moved')
    expect(move('en', 'Todo → Dev')).toBe('Todo → Dev')
  })

  it('names a standard key the workflow does not hold, or a card read with none, by its state', () => {
    expect(move('ru', 'ready')).toBe('Готово к работе')
    expect(move('en', 'ready', 'translated', undefined)).toBe('Ready')
    expect(move('ru', 'triage: moved', 'translated', undefined)).toBe('Не разобрано: moved')
  })

  it.each([
    [
      'ru',
      'deferred: until 2026-12-01: waits for the vendor',
      'Отложено: до [2026-12-01] — waits for the vendor',
    ],
    [
      'en',
      'deferred: until 2026-12-01T15:00:00Z: later',
      'Deferred: until [2026-12-01T15:00:00Z] — later',
    ],
    ['ru', 'deferred: until MAIN-12: ', 'Отложено: до закрытия MAIN-12'],
    ['en', 'deferred: until MAIN-12', 'Deferred: until MAIN-12 closes'],
    ['ru', 'deferred: until 1 comment: waits', 'Отложено: до 1 нового комментария — waits'],
    ['en', 'deferred: until 3 comments', 'Deferred: until 3 new comments'],
    [
      'ru',
      'deferred: until 2026-12-01 or 3 comments: waits',
      'Отложено: до [2026-12-01] или до 3 новых комментариев — что наступит раньше — waits',
    ],
    [
      'en',
      'deferred: until 2026-12-01T15:00:00Z or 1 comment',
      'Deferred: until [2026-12-01T15:00:00Z] or until 1 new comment, whichever comes first',
    ],
    ['ru', 'triage: returned, comments 3', 'Не разобрано: появились 3 новых комментария'],
    ['ru', 'ready: returned, date 2026-12-01', 'Готово к работе: наступило [2026-12-01]'],
    ['en', 'ready: returned, completed MAIN-12', 'Ready: MAIN-12 is done'],
    // A writer's own note stays as written, even one that begins like the service's.
    ['ru', 'dev: until the review is done, waits', 'В работе: until the review is done, waits'],
    ['ru', 'dev: claimed', 'В работе: взята в работу'],
    ['en', 'ready: launch_failed', 'Ready: the launch failed'],
    ['ru', 'ready: accepted with MAIN-3', 'Готово к работе: принята вместе с MAIN-3'],
    ['ru', 'cancelled: duplicate of MAIN-9', 'Отменено: дубликат MAIN-9'],
    [
      'ru',
      'triage: moved out of MAIN-3: not part of it',
      'Не разобрано: вынесена из MAIN-3: not part of it',
    ],
  ] as const)('%s «%s» reads «%s»', (locale, detail, words) => {
    expect(move(locale, detail, 'translated', undefined)).toBe(words)
  })
})

function said(locale: 'en' | 'ru', action: string, detail: string) {
  const { t } = createI18n({ legacy: false, locale, messages, pluralRules }).global
  return eventWords({ action, detail }, { comments: [], t, day })
}

describe('a work event in the history', () => {
  it.each([
    ['ru', 'accepted', 'inherited', 'как часть цели'],
    ['en', 'accepted', 'owner', 'owner'],
    ['ru', 'accepted', 'label_rule: docs', 'по правилу метки «docs»'],
    ['en', 'accepted', 'label_rule: docs', 'by label rule “docs”'],
    ['ru', 'returned', 'date 2026-12-01', 'наступило [2026-12-01]'],
    ['ru', 'returned', 'cancelled MAIN-12', 'MAIN-12 отменена'],
    ['en', 'returned', 'deleted MAIN-12', 'MAIN-12 is deleted'],
    ['ru', 'returned', 'comments 1', 'появился 1 новый комментарий'],
    ['ru', 'returned', 'comments 5', 'появилось 5 новых комментариев'],
    ['en', 'returned', 'comments 2', '2 new comments came'],
    ['ru', 'triage_seen', 'seen', 'просмотрено и оставлено как есть'],
    ['en', 'triage_seen', 'cleared', 'mark taken away'],
    ['ru', 'child_left', 'MAIN-12: moved under MAIN-3', 'MAIN-12 перенесена в MAIN-3'],
    ['ru', 'split_off', 'MAIN-15: 2 steps', 'MAIN-15: 2 условия'],
    ['ru', 'split_off', 'MAIN-15: 5 steps', 'MAIN-15: 5 условий'],
    ['en', 'split_off', 'MAIN-15: 1 steps', 'MAIN-15: 1 condition'],
    ['ru', 'converted', 'task -> stage', 'Задача → Этап'],
    ['ru', 'opened', 'converted from a bug', 'прежний тип: Дефект'],
    ['en', 'opened', 'converted from an improvement', 'kind before: Improvement'],
    ['en', 'opened', 'the owner asked', 'the owner asked'],
    [
      'en',
      'converted',
      'goal -> task; leftover MAIN-15: 2 steps; projects dropped: alpha, beta',
      'Goal → Task; the rest went to MAIN-15: 2 conditions; projects dropped: alpha, beta',
    ],
  ] as const)('%s %s «%s» reads «%s»', (locale, action, detail, words) => {
    expect(said(locale, action, detail)).toBe(words)
  })

  it('keeps an agent’s own line, and a line of another shape, as recorded', () => {
    expect(said('ru', 'child_left', 'MAIN-12: no longer part of it')).toBe(
      'MAIN-12: no longer part of it',
    )
    expect(said('en', 'accepted', 'someone')).toBe('someone')
    expect(said('en', 'converted', 'task -> stage; something else')).toBe(
      'task -> stage; something else',
    )
    expect(said('en', 'returned', 'date')).toBe('date')
    expect(said('en', 'returned', 'comments many')).toBe('comments many')
  })

  it('has a title for every event the service records', () => {
    const words = createI18n({ legacy: false, locale: 'ru', messages, pluralRules }).global
    for (const locale of ['en', 'ru'] as const)
      for (const action of EVENT_ACTIONS)
        expect(words.te(`activity.${action}`, locale), `${locale} activity.${action}`).toBe(true)
  })

  it('says each service line of the server’s own answers in the reader’s words', () => {
    const { t } = createI18n({ legacy: false, locale: 'ru', messages, pluralRules }).global
    const nameState = stateNamer(undefined, (state) =>
      stateName(state, 'translated', (message) => t(message)),
    )
    const lines = [convertedCard, deferredCard, returnedCard].flatMap((card) =>
      card.events.map((event) => eventWords(event, { comments: [], t, nameState, day })),
    )
    expect(lines).toEqual(
      expect.arrayContaining([
        'Не разобрано',
        'по поручению',
        'В работе: взята в работу',
        'прежний тип: Дефект',
        'Дефект → Цель; остальное ушло в MAIN-24: 0 условий',
        'Отложено: до закрытия MAIN-20 — Waits for the other card.',
        'Не разобрано: MAIN-22 удалена',
        'MAIN-22 удалена',
      ]),
    )
    // No line keeps the service's English shape.
    for (const line of lines) expect(line).not.toMatch(/until |returned, | steps\b|claimed|->/u)
  })
})
