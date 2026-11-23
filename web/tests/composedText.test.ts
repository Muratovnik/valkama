/**
 * The texts the service composes, said in the reader's language from their key and values:
 * every key in English and Russian, and a text with no key shown as it was stored. The English
 * says what the service's own text says, in the interface's words: a step is a condition, a
 * question names its answers as its buttons do and calls its own card «this», whose number and
 * title the head over it shows (`composedTextMessages.ts`).
 */
import { describe, expect, it } from 'vitest'

import { promptMessageSchema, whatMessageSchema } from '@/shared/api/composedTextModel.ts'
import type { WhatMessage } from '@/shared/api/composedTextModel.ts'
import { validateDecisionsPage } from '@/shared/api/decisionsApi.ts'
import { validateInputRequestDetail } from '@/shared/api/inputRequestModel.ts'
import { promptShown, whatShown } from '@/shared/lib/composedText.ts'

import { prompt, QUESTIONS, sayIn, state } from './support/composedQuestions.ts'
import type { Locale } from './support/composedQuestions.ts'
import { readServerFixture } from './support/serverFixtures.ts'

const what = (message: WhatMessage, locale: Locale) =>
  whatShown({ what: 'stored', what_message: message }, sayIn(locale))

/** Each key of a decision, its values, and what it says in English and in Russian. */
const DECISIONS: [WhatMessage, string, string][] = [
  [
    { key: 'accepted', values: { reference: 'MAIN-12', under: null, label: null } },
    'accepted MAIN-12',
    'принято: MAIN-12',
  ],
  [
    { key: 'accepted', values: { reference: 'MAIN-12', under: 'MAIN-3', label: null } },
    'accepted MAIN-12 under MAIN-3',
    'принято: MAIN-12 в MAIN-3',
  ],
  [
    { key: 'accepted', values: { reference: 'MAIN-12', under: null, label: 'docs' } },
    'accepted MAIN-12 by the label docs',
    'принято: MAIN-12 по метке «docs»',
  ],
  [
    { key: 'moved', values: { reference: 'MAIN-12', under: 'MAIN-3' } },
    'moved MAIN-12 under MAIN-3',
    'перенесено: MAIN-12 в MAIN-3',
  ],
  [
    { key: 'cancelled', values: { reference: 'MAIN-12', question: null } },
    'cancel MAIN-12',
    'отмена MAIN-12',
  ],
  [
    {
      key: 'cancelled',
      values: { reference: 'MAIN-12', question: '6f1c2a8e-0000-4000-8000-0000000000b1' },
    },
    'cancel MAIN-12 following question 6f1c2a8e-0000-4000-8000-0000000000b1',
    'отмена MAIN-12 после ответа на вопрос 6f1c2a8e-0000-4000-8000-0000000000b1',
  ],
  [{ key: 'closed', values: { reference: 'MAIN-3' } }, 'close MAIN-3', 'закрытие MAIN-3'],
  [
    {
      key: 'put_off',
      values: { reference: 'MAIN-3', until: '2026-12-01', comments: null, reason: 'later' },
    },
    'put off MAIN-3 until 2026-12-01: later',
    'отложено: MAIN-3 до 2026-12-01: later',
  ],
  [
    {
      key: 'put_off',
      values: { reference: 'MAIN-3', until: '2026-12-01', comments: 5, reason: 'later' },
    },
    'put off MAIN-3 until 2026-12-01 or 5 new comments, whichever comes first: later',
    'отложено: MAIN-3 до 2026-12-01 или 5 новых комментариев — что наступит раньше: later',
  ],
  [
    {
      key: 'steps',
      values: {
        changes: [
          { change: 'removed', before: 'Old', after: null },
          { change: 'rewrote', before: 'Write it', after: 'Write all' },
          { change: 'clarified', before: 'Test', after: 'Test it' },
        ],
        reason: 'the export changed',
      },
    },
    'removed condition «Old»; rewrote condition «Write it» → «Write all»: the export changed; clarified condition «Test» → «Test it»',
    'снято условие «Old»; переписано условие «Write it» → «Write all»: the export changed; уточнено условие «Test» → «Test it»',
  ],
  [
    { key: 'chose', values: { labels: ['One table', 'Docs'] } },
    'chose «One table», «Docs»',
    'выбрано: «One table», «Docs»',
  ],
  [
    { key: 'group', values: { title: 'Export findings', answer: 'later', count: 2 } },
    'group «Export findings»: later 2 items',
    'группа «Export findings»: позже, 2 находки',
  ],
]

const keysOf = (union: { options: readonly { shape: { key: { value: string } } }[] }) =>
  union.options.map((option) => option.shape.key.value)
const valuesOf = (option: { shape: { values: unknown } }) => {
  const values = option.shape.values as { out?: { shape: object }; shape?: object }
  return Object.keys(values.out?.shape ?? values.shape ?? {}).toSorted()
}

describe('a text the service composed', () => {
  it.each(QUESTIONS)('says the question %j in both languages', (message, en, ru) => {
    expect(() => promptMessageSchema.parse(message)).not.toThrow()
    expect(prompt(message, 'en')).toBe(en)
    expect(prompt(message, 'ru')).toBe(ru)
  })

  it.each(DECISIONS)('says the decision %j in both languages', (message, en, ru) => {
    expect(() => whatMessageSchema.parse(message)).not.toThrow()
    expect(what(message, 'en')).toBe(en)
    expect(what(message, 'ru')).toBe(ru)
  })

  it('has an example of every key the web reads', () => {
    expect(new Set(QUESTIONS.map(([message]) => message.key))).toEqual(
      new Set(keysOf(promptMessageSchema)),
    )
    expect(new Set(DECISIONS.map(([message]) => message.key))).toEqual(
      new Set(keysOf(whatMessageSchema)),
    )
  })

  it('reads the keys and values the service defines, no more and no fewer', () => {
    const defined = readServerFixture('composed-texts.json') as Record<
      'questions' | 'decisions',
      Record<string, string[]>
    >
    const read = (union: typeof promptMessageSchema | typeof whatMessageSchema) =>
      Object.fromEntries(union.options.map((option) => [option.shape.key.value, valuesOf(option)]))
    const sorted = (keys: Record<string, string[]>) =>
      Object.fromEntries(Object.entries(keys).map(([key, names]) => [key, names.toSorted()]))
    expect(read(promptMessageSchema)).toEqual(sorted(defined.questions))
    expect(read(whatMessageSchema)).toEqual(sorted(defined.decisions))
  })

  it('is refused with a key or a value the service does not define', () => {
    expect(() => promptMessageSchema.parse({ key: 'unknown', values: {} })).toThrow()
    expect(() =>
      promptMessageSchema.parse({ key: 'group_asked', values: { count: 2, title: 'T', more: 1 } }),
    ).toThrow()
    expect(() => whatMessageSchema.parse({ key: 'closed', values: {} })).toThrow()
  })
})

describe('the server fixtures of composed texts', () => {
  // The service's English names the answers an agent sends and the card's title, which the
  // interface says in its own words under the head that already names that card.
  it.each([
    ['request-proposed-goal.json', 'An agent proposes this goal. Do it, later, or don’t do it?'],
    ['request-triage-group.json', 'Group of 2 items'],
  ])('%s says the question the service asked, in the interface’s words', (name, en) => {
    const request = validateInputRequestDetail(readServerFixture(name)).request
    expect(request.prompt_message).not.toBeNull()
    expect(request.prompt).toContain(request.title)
    expect(promptShown(request, sayIn('en'), state)).toBe(en)
    expect(promptShown(request, sayIn('ru'), state)).not.toBe(en)
  })

  it('say each decision in English as the service wrote it, and one without a key as stored', () => {
    const { items } = validateDecisionsPage(readServerFixture('decisions.json'))
    const keyed = items.filter((item) => item.what_message)
    expect(keyed.length).toBeGreaterThan(0)
    for (const decision of keyed) {
      expect(whatShown(decision, sayIn('en'))).toBe(decision.what)
      expect(whatShown(decision, sayIn('ru'))).not.toBe(decision.what)
    }
  })
})

describe('a text with no key', () => {
  it.each<Locale>(['en', 'ru'])('is shown as it was stored, in %s', (locale) => {
    const say = sayIn(locale)
    expect(promptShown({ prompt: 'As **an agent** wrote it' }, say, state)).toBe(
      'As **an agent** wrote it',
    )
    expect(promptShown({ prompt: 'Stored before keys', prompt_message: null }, say, state)).toBe(
      'Stored before keys',
    )
    expect(whatShown({ what: 'accepted MAIN-12', what_message: null }, say)).toBe(
      'accepted MAIN-12',
    )
  })
})
