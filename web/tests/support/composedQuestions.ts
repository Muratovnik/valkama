/**
 * Every key of a question Valkama composes, with its values and what it says in English and
 * in Russian, and the words that say it: the examples the tests of composed texts read.
 */
import { createI18n } from 'vue-i18n'

import type { PromptMessage } from '@/shared/api/composedTextModel.ts'
import { messages, pluralRules } from '@/shared/i18n/index.ts'
import { promptShown } from '@/shared/lib/composedText.ts'
import type { Say } from '@/shared/lib/composedText.ts'

export type Locale = 'en' | 'ru'

export const sayIn = (locale: Locale): Say => {
  const { t } = createI18n({ legacy: false, locale, messages, pluralRules }).global
  return (key, values = {}, count) => (count === undefined ? t(key, values) : t(key, values, count))
}
/** A state's name, as the owner's settings would give it. */
export const state = (key: string) => ({ review: 'Review' })[key] ?? key

export const prompt = (message: PromptMessage, locale: Locale) =>
  promptShown({ prompt: 'stored', prompt_message: message }, sayIn(locale), state)

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
export const QUESTIONS: [PromptMessage, string, string][] = [
  [
    { key: 'task_filed', values: { reference: 'MAIN-12', goal: 'MAIN-3', title: 'Export it' } },
    'An agent files this task in MAIN-3. Do it, later, move out of the goal, or don’t do it?',
    'Агент добавляет эту задачу в MAIN-3. Делать, позже, вынести из цели или не делать?',
  ],
  [
    { key: 'task_moved_in', values: { reference: 'MAIN-12', goal: 'MAIN-3', title: 'Export it?' } },
    'An agent moves this task into MAIN-3. Do it, later, leave it where it was, or don’t do it?',
    'Агент переносит эту задачу в MAIN-3. Делать, позже, оставить где была или не делать?',
  ],
  [
    {
      key: 'task_moved_to',
      values: { reference: 'MAIN-12', goal: 'MAIN-3', state: 'review', title: 'Export it' },
    },
    'An agent moves this task, lying in MAIN-3, to Review. Do it and move it there, later, move out of the goal, or don’t do it?',
    'Агент переводит эту задачу из MAIN-3 в состояние «Review». Делать и перевести, позже, вынести из цели или не делать?',
  ],
  [
    { key: 'goal_proposed', values: { reference: 'MAIN-3', title: 'Exports' } },
    'An agent proposes this goal. Do it, later, or don’t do it?',
    'Агент предлагает эту цель. Делать, позже или не делать?',
  ],
  [
    { key: 'goal_came_back', values: { reference: 'MAIN-3', title: 'Exports' } },
    'This goal came back from being put off. Do it, later, or don’t do it?',
    'Цель вернулась после того, как её отложили. Делать, позже или не делать?',
  ],
  [
    {
      key: 'put_off_asked',
      values: {
        reference: 'MAIN-3',
        kind: 'stage',
        title: 'Exports',
        until: '2026-12-01',
        comments: null,
        reason: 'after the release',
      },
    },
    'An agent puts off this accepted stage until 2026-12-01. Do it, later, or don’t do it? Its reason: after the release.',
    'Агент откладывает этот принятый этап до 2026-12-01. Делать, позже или не делать? Причина: after the release.',
  ],
  [
    {
      key: 'put_off_asked',
      values: {
        reference: 'MAIN-3',
        kind: 'goal',
        title: 'Exports',
        until: null,
        comments: 1,
        reason: 'waits for word',
      },
    },
    'An agent puts off this accepted goal until 1 new comment. Do it, later, or don’t do it? Its reason: waits for word.',
    'Агент откладывает эту принятую цель до 1 нового комментария. Делать, позже или не делать? Причина: waits for word.',
  ],
  [
    {
      key: 'put_off_asked',
      values: {
        reference: 'MAIN-3',
        kind: 'stage',
        title: 'Exports',
        until: '2026-12-01',
        comments: 3,
        reason: 'waits for word',
      },
    },
    'An agent puts off this accepted stage until 2026-12-01 or 3 new comments, whichever comes first. Do it, later, or don’t do it? Its reason: waits for word.',
    'Агент откладывает этот принятый этап до 2026-12-01 или 3 новых комментариев — что наступит раньше. Делать, позже или не делать? Причина: waits for word.',
  ],
  [
    {
      key: 'put_off_came',
      values: { reference: 'MAIN-3', until: '1 December', item: null, comments: null },
    },
    'Put off until 1 December; that has come. Do it, later, or don’t do it?',
    'Отложено до 1 December, и этот срок настал. Делать, позже или не делать?',
  ],
  [
    {
      key: 'put_off_came',
      values: { reference: 'MAIN-3', until: null, item: 'MAIN-2', comments: null },
    },
    'Put off until MAIN-2 closed; that has come. Do it, later, or don’t do it?',
    'Отложено до закрытия MAIN-2, и это время настало. Делать, позже или не делать?',
  ],
  [
    {
      key: 'put_off_came',
      values: { reference: 'MAIN-3', until: null, item: null, comments: 2 },
    },
    'Put off until 2 new comments; that has come. Do it, later, or don’t do it?',
    'Отложено до 2 новых комментариев, и это условие выполнено. Делать, позже или не делать?',
  ],
  [
    {
      key: 'put_off_came',
      values: { reference: 'MAIN-3', until: null, item: null, comments: 21 },
    },
    'Put off until 21 new comments; that has come. Do it, later, or don’t do it?',
    'Отложено до 21 нового комментария, и это условие выполнено. Делать, позже или не делать?',
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
    'An agent cancels this, which other sessions work on. Cancel it, or keep it? Its reason: done elsewhere. BETA session objects: still in use. Not every session answered within a day: ALPHA session did not.',
    'Агент отменяет эту работу, а над ней работают и другие сессии. Отменить или оставить? Причина: done elsewhere. BETA session возражает: still in use. Не все сессии ответили за сутки; не ответили: ALPHA session.',
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
    'An agent cancels this, filed outside its own work. Cancel it, or keep it? The sessions are asked as well, and their answers show here.',
    'Агент отменяет эту работу, заведённую вне его собственной. Отменить или оставить? Сессии тоже спрошены, их ответы появятся здесь.',
  ],
  [
    { key: 'cancel_consent', values: { reference: 'MAIN-12', title: 'Export it', reason: null } },
    "Another session's agent cancels this, work you take part in. Answer agree, object with a reason, or move your work out of it with move_out and answer moved_out.",
    'Агент другой сессии отменяет эту работу, в которой вы участвуете. Ответьте agree, возразите с причиной или вынесите свою работу через move_out и ответьте moved_out.',
  ],
  [
    { key: 'confirm_asked', values: confirmation },
    `All work under it is closed: confirm it, or leave it to the next session that takes work in this space.\n\n${under}`,
    `Вся работа внутри закрыта: подтвердить или оставить следующей сессии, которая возьмёт работу в этом пространстве?\n\n${underRu}`,
  ],
  [
    { key: 'confirm_agent', values: { ...confirmation, summary: 'All exported' } },
    `An agent confirms it: all work under it is closed, and its summary says: All exported. Confirm it, or leave it to the next session that takes work in this space.\n\n${under}`,
    `Агент подтверждает: вся работа внутри закрыта, итог агента: All exported. Подтвердить или оставить следующей сессии, которая возьмёт работу в этом пространстве?\n\n${underRu}`,
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
    'An agent closes it, though it has nothing under it. Confirm it, or leave it open.\n\nIt has no conditions: check what was done against its description.',
    'Агент закрывает, хотя внутри нет работы. Подтвердить или оставить открытой?\n\nУсловий нет: сверьте сделанное с описанием.',
  ],
  [
    { key: 'confirm_asked', values: { ...confirmation, moved_out: [], steps: [], hidden: 3 } },
    'All work under it is closed: confirm it, or leave it to the next session that takes work in this space.\n\nCancelled:\n- MAIN-4: not needed\n(3 more lines not shown: see the card)',
    'Вся работа внутри закрыта: подтвердить или оставить следующей сессии, которая возьмёт работу в этом пространстве?\n\nОтменено:\n- MAIN-4: not needed\n(не показаны ещё 3 строки: см. карточку)',
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
    'An agent changes the conditions of this goal. Allow it, or keep the conditions as they are?\n- remove «Old step»\n- «Write it» → «Write every field»\nIts reason: the export changed.',
    'Агент меняет условия этой цели. Разрешить или оставить условия как есть?\n- снять «Old step»\n- «Write it» → «Write every field»\nПричина: the export changed.',
  ],
  [
    { key: 'group_asked', values: { count: 2, title: 'Export findings' } },
    'Group of 2 items',
    'Группа находок (2)',
  ],
  [
    { key: 'group_asked', values: { count: 1, title: 'Export findings' } },
    'Group of 1 item',
    'Группа находок (1)',
  ],
]
