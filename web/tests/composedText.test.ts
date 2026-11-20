/**
 * The texts the service composes, said in the reader's language from their key and values:
 * every key in English and Russian, the English the same as the service's own text for the
 * questions the real server asked (`fixtures/server/`) but for the interface's word for a step,
 * a condition, and a text with no key shown as it was stored.
 */
import { createI18n } from 'vue-i18n'

import { describe, expect, it } from 'vitest'

import { promptMessageSchema, whatMessageSchema } from '@/shared/api/composedTextModel.ts'
import type { PromptMessage, WhatMessage } from '@/shared/api/composedTextModel.ts'
import { validateDecisionsPage } from '@/shared/api/decisionsApi.ts'
import { validateInputRequestDetail } from '@/shared/api/inputRequestModel.ts'
import { messages, pluralRules } from '@/shared/i18n/index.ts'
import { promptShown, whatShown } from '@/shared/lib/composedText.ts'
import type { Say } from '@/shared/lib/composedText.ts'

import { readServerFixture } from './support/serverFixtures.ts'

type Locale = 'en' | 'ru'

const sayIn = (locale: Locale): Say => {
  const { t } = createI18n({ legacy: false, locale, messages, pluralRules }).global
  return (key, values = {}, count) => (count === undefined ? t(key, values) : t(key, values, count))
}
/** A state's name, as the owner's settings would give it. */
const state = (key: string) => ({ review: 'Review' })[key] ?? key

const prompt = (message: PromptMessage, locale: Locale) =>
  promptShown({ prompt: 'stored', prompt_message: message }, sayIn(locale), state)
const what = (message: WhatMessage, locale: Locale) =>
  whatShown({ what: 'stored', what_message: message }, sayIn(locale))

const confirmation = {
  reference: 'MAIN-3',
  cancelled: [{ reference: 'MAIN-4', reason: 'not needed' }],
  moved_out: [{ reference: 'MAIN-5', reason: null }],
  steps: ['The export writes every field'],
  hidden: 0,
}
const under =
  'Cancelled:\n- MAIN-4: not needed\n\nMoved out:\n- MAIN-5\n\nIts conditions:\n- The export writes every field'
const underRu =
  'Отменено:\n- MAIN-4: not needed\n\nВынесено:\n- MAIN-5\n\nУсловия:\n- The export writes every field'

/** Each key of a question, its values, and what it says in English and in Russian. */
const QUESTIONS: [PromptMessage, string, string][] = [
  [
    { key: 'task_filed', values: { reference: 'MAIN-12', goal: 'MAIN-3', title: 'Export it' } },
    'An agent files the task MAIN-12 in MAIN-3: Export it. Take it on, put it off, move it out of the goal, or drop it.',
    'Агент добавляет задачу MAIN-12 в MAIN-3: Export it. Делать, отложить, вынести из цели или не делать?',
  ],
  [
    { key: 'task_moved_in', values: { reference: 'MAIN-12', goal: 'MAIN-3', title: 'Export it?' } },
    'An agent moves the task MAIN-12 into MAIN-3: Export it? Take it on, put it off, leave it where it was, or drop it.',
    'Агент переносит задачу MAIN-12 в MAIN-3: Export it? Делать, отложить, оставить где была или не делать?',
  ],
  [
    {
      key: 'task_moved_to',
      values: { reference: 'MAIN-12', goal: 'MAIN-3', state: 'review', title: 'Export it' },
    },
    'An agent moves the task MAIN-12, lying in MAIN-3, to Review: Export it. Take it on and move it there, put it off, move it out of the goal, or drop it.',
    'Агент переводит задачу MAIN-12 из MAIN-3 в состояние «Review»: Export it. Делать и перевести, отложить, вынести из цели или не делать?',
  ],
  [
    { key: 'goal_proposed', values: { reference: 'MAIN-3', title: 'Exports' } },
    'An agent proposes the goal MAIN-3: Exports. Take it on, put it off, or drop it.',
    'Агент предлагает цель MAIN-3: Exports. Делать, отложить или не делать?',
  ],
  [
    { key: 'goal_came_back', values: { reference: 'MAIN-3', title: 'Exports' } },
    'The goal MAIN-3 came back from being put off: Exports. Take it on, put it off, or drop it.',
    'Цель MAIN-3 вернулась после того, как её отложили: Exports. Делать, отложить или не делать?',
  ],
  [
    {
      key: 'put_off_asked',
      values: {
        reference: 'MAIN-3',
        kind: 'stage',
        title: 'Exports',
        until: '2026-12-01',
        reason: 'after the release',
      },
    },
    'An agent puts off MAIN-3, an accepted stage: Exports. Until 2026-12-01. Its reason: after the release. Keep it, put it off, or drop it.',
    'Агент откладывает принятый этап MAIN-3: Exports. До 2026-12-01. Причина: after the release. Оставить, отложить или не делать?',
  ],
  [
    { key: 'put_off_came', values: { reference: 'MAIN-3', until: '1 December', item: null } },
    'MAIN-3 was put off until 1 December; that has come. Do it, put it off again, or drop it.',
    'MAIN-3 отложили до 1 December, и этот срок настал. Делать, отложить снова или не делать?',
  ],
  [
    { key: 'put_off_came', values: { reference: 'MAIN-3', until: null, item: 'MAIN-2' } },
    'MAIN-3 was put off until MAIN-2 closed; that has come. Do it, put it off again, or drop it.',
    'MAIN-3 отложили до закрытия MAIN-2, и это время настало. Делать, отложить снова или не делать?',
  ],
  [
    {
      key: 'cancel_asked',
      values: {
        reference: 'MAIN-12',
        point: 'cancel_shared',
        title: 'Export it',
        reason: 'done elsewhere',
        sessions_asked: false,
        objections: [{ session: 'BETA session', reason: 'still in use' }],
        unanswered: ['ALPHA session'],
      },
    },
    'An agent cancels MAIN-12, which other sessions work on: Export it. Its reason: done elsewhere. BETA session objects: still in use. Not every session answered within a day: ALPHA session did not. Cancel it, or keep it.',
    'Агент отменяет MAIN-12 (над этим работают и другие сессии): Export it. Причина: done elsewhere. BETA session возражает: still in use. Не все сессии ответили за сутки; не ответили: ALPHA session. Отменить или оставить?',
  ],
  [
    {
      key: 'cancel_asked',
      values: {
        reference: 'MAIN-12',
        point: 'cancel_outside',
        title: 'Export it',
        reason: null,
        sessions_asked: true,
        objections: [],
        unanswered: [],
      },
    },
    'An agent cancels MAIN-12, filed outside its own work: Export it. The sessions are asked as well, and their answers show here. Cancel it, or keep it.',
    'Агент отменяет MAIN-12 (заведено вне его собственной работы): Export it. Сессии тоже спрошены, их ответы появятся здесь. Отменить или оставить?',
  ],
  [
    { key: 'cancel_consent', values: { reference: 'MAIN-12', title: 'Export it', reason: null } },
    "Another session's agent cancels MAIN-12, work you take part in: Export it. Answer agree, object with a reason, or move your work out of it with move_out and answer moved_out.",
    'Агент другой сессии отменяет MAIN-12 — работу, в которой вы участвуете: Export it. Ответьте agree, возразите с причиной или вынесите свою работу через move_out и ответьте moved_out.',
  ],
  [
    { key: 'confirm_asked', values: confirmation },
    `All work under MAIN-3 is closed: confirm it, or leave it to the next session that takes work in this space.\n\n${under}`,
    `Вся работа под MAIN-3 закрыта: подтвердить или оставить следующей сессии, которая возьмёт работу в этом пространстве?\n\n${underRu}`,
  ],
  [
    { key: 'confirm_agent', values: { ...confirmation, summary: 'All exported' } },
    `An agent confirms MAIN-3: all work under it is closed, and its summary says: All exported. Confirm it, or leave it to the next session that takes work in this space.\n\n${under}`,
    `Агент подтверждает MAIN-3: вся работа внутри закрыта, итог агента: All exported. Подтвердить или оставить следующей сессии, которая возьмёт работу в этом пространстве?\n\n${underRu}`,
  ],
  [
    {
      key: 'confirm_agent_empty',
      values: {
        reference: 'MAIN-3',
        cancelled: [],
        moved_out: [],
        steps: [],
        hidden: 0,
        summary: null,
      },
    },
    'An agent closes MAIN-3, which has nothing under it. Confirm it, or leave it open.\n\nIt has no conditions: check what was done against its description.',
    'Агент закрывает MAIN-3: внутри нет работы. Подтвердить или не закрывать?\n\nУсловий нет: сверьте сделанное с описанием.',
  ],
  [
    { key: 'confirm_asked', values: { ...confirmation, moved_out: [], steps: [], hidden: 3 } },
    'All work under MAIN-3 is closed: confirm it, or leave it to the next session that takes work in this space.\n\nCancelled:\n- MAIN-4: not needed\n(3 more lines not shown: see MAIN-3)',
    'Вся работа под MAIN-3 закрыта: подтвердить или оставить следующей сессии, которая возьмёт работу в этом пространстве?\n\nОтменено:\n- MAIN-4: not needed\n(не показаны ещё 3 строки: см. MAIN-3)',
  ],
  [
    {
      key: 'steps_asked',
      values: {
        reference: 'MAIN-3',
        kind: 'goal',
        title: 'Exports',
        removed: ['Old step'],
        rewritten: [{ from: 'Write it', to: 'Write every field' }],
        reason: 'the export changed',
      },
    },
    'An agent changes the conditions of MAIN-3, a goal: Exports.\n- remove «Old step»\n- «Write it» → «Write every field»\nIts reason: the export changed. Allow it, or keep the conditions as they are.',
    'Агент меняет условия цели MAIN-3: Exports.\n- снять «Old step»\n- «Write it» → «Write every field»\nПричина: the export changed. Разрешить или оставить условия как есть?',
  ],
  [
    { key: 'group_asked', values: { count: 2, title: 'Export findings' } },
    'Group of 2 items: «Export findings»',
    'Группа находок (2): «Export findings»',
  ],
  [
    { key: 'group_asked', values: { count: 1, title: 'Export findings' } },
    'Group of 1 item: «Export findings»',
    'Группа находок (1): «Export findings»',
  ],
]

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
    { key: 'put_off', values: { reference: 'MAIN-3', until: '2026-12-01', reason: 'later' } },
    'put off MAIN-3 until 2026-12-01: later',
    'отложено: MAIN-3 до 2026-12-01: later',
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
  it.each(['request-proposed-goal.json', 'request-triage-group.json'])(
    '%s says in English what the service wrote',
    (name) => {
      const request = validateInputRequestDetail(readServerFixture(name)).request
      expect(request.prompt_message).not.toBeNull()
      expect(promptShown(request, sayIn('en'), state)).toBe(request.prompt)
      expect(promptShown(request, sayIn('ru'), state)).not.toBe(request.prompt)
    },
  )

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
