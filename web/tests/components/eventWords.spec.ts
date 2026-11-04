/**
 * The history in words: a mark names its thread and its decision, a link reads from this
 * task's side, and a question's id stays in the record without standing in the row.
 */
import { createI18n } from 'vue-i18n'

import { describe, expect, it } from 'vitest'

import { eventWords } from '@/widgets/work-item-inspector/utils/eventWords.ts'

import { messages, pluralRules } from '@/shared/i18n/index.ts'

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
  return eventWords({ action, detail }, comments, t, questions)
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

  it('leaves a line of an unknown shape, and every other event, as it was recorded', () => {
    expect(say('en', 'linked', 'parent of MAIN-7')).toBe('parent of MAIN-7')
    expect(say('en', 'comment_resolved', 'not a number')).toBe('not a number')
    expect(say('en', 'transitioned', 'dev: started')).toBe('dev: started')
  })
})
