/**
 * The history in words: a mark names its thread and its decision, a link reads from this
 * task's side, a question's id stays in the record without standing in the row, and a
 * transition names its state as every other place does, through the card's workflow.
 */
import { createI18n } from 'vue-i18n'

import { describe, expect, it } from 'vitest'

import { eventWords } from '@/widgets/work-item-inspector/utils/eventWords.ts'

import { messages, pluralRules } from '@/shared/i18n/index.ts'
import { stateName } from '@/shared/lib/stateNames.ts'
import type { StateNaming } from '@/shared/lib/stateNames.ts'

import { requestEntry } from '../support/inputRequests.ts'
import { root } from '../support/threadCard.ts'

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

function move(locale: 'en' | 'ru', detail: string, naming: StateNaming = 'translated') {
  const { t } = createI18n({ legacy: false, locale, messages, pluralRules }).global
  const nameState = (key: string) => {
    const state = STATES.find((one) => one.key === key)
    return state ? stateName(state, naming, (message) => t(message)) : null
  }
  return eventWords({ action: 'transitioned', detail }, { comments: [], t, nameState })
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

  it('keeps a key the workflow no longer has, and a line of another shape, as recorded', () => {
    expect(move('ru', 'triage: moved')).toBe('triage: moved')
    expect(move('en', 'Todo → Dev')).toBe('Todo → Dev')
  })
})
