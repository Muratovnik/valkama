/**
 * The words of the texts the service composes, said from their key and values
 * (`shared/api/composedTextModel.ts`): the prompts of the questions it asks and what the
 * summary of agent decisions says was decided. Each English line says what the service's own
 * English text says, in the interface's words: a step of a goal or stage is a condition, as
 * everywhere on the screen, and a question names its answers in the words of the controls that
 * answer it (`questionKindMessages.ts`), not by the options the service offers an agent.
 *
 * A question stands under a head that names its card by number and title, and on its card under
 * the card's own, so it calls that card «this» and says neither again; another card, such as a
 * task's goal, it names by number. Its ask follows its first sentence and comes before the
 * agent's own words, so that a long reason folds away under «Show all» and the ask stays in
 * sight. A title, a reason, a summary and a condition's text are the agent's words and come in
 * as values, as written. `composedText.ts` puts the lines together.
 */
export const composedTextMessages = {
  en: {
    question: {
      task_filed:
        'An agent files this task in {goal}. Do it, later, move out of the goal, or don’t do it?',
      task_moved_in:
        'An agent moves this task into {goal}. Do it, later, leave it where it was, or don’t do it?',
      task_moved_to:
        'An agent moves this task, lying in {goal}, to {state}. Do it and move it there, later, move out of the goal, or don’t do it?',
      goal_proposed: 'An agent proposes this goal. Do it, later, or don’t do it?',
      goal_came_back: 'This goal came back from being put off. Do it, later, or don’t do it?',
      put_off_asked: {
        goal: 'An agent puts off this accepted goal until {until}. Do it, later, or don’t do it? Its reason: {reason}',
        stage:
          'An agent puts off this accepted stage until {until}. Do it, later, or don’t do it? Its reason: {reason}',
      },
      put_off_came: {
        until: 'Put off until {until}; that has come. Do it, later, or don’t do it?',
        item: 'Put off until {item} closed; that has come. Do it, later, or don’t do it?',
        comments: 'Put off until {comments}; that has come. Do it, later, or don’t do it?',
      },
      cancel_asked: {
        cancel_outside: 'An agent cancels this, filed outside its own work.',
        cancel_shared: 'An agent cancels this, which other sessions work on.',
        reason: 'Its reason: {reason}',
        sessions: 'The sessions are asked as well, and their answers show here.',
        objects: '{session} objects: {reason}',
        unanswered: 'Not every session answered within a day: {sessions} did not.',
        ask: 'Cancel it, or keep it?',
      },
      cancel_consent: {
        head: "Another session's agent cancels this, work you take part in.",
        reason: 'Its reason: {reason}',
        ask: 'Answer agree, object with a reason, or move your work out of it with move_out and answer moved_out.',
      },
      confirm: {
        asked:
          'All work under it is closed: confirm it, or leave it to the next session that takes work in this space.',
        agent: 'An agent confirms it: all work under it is closed',
        agent_empty: 'An agent closes it, though it has nothing under it',
        summary: ', and its summary says: {summary}',
        agentAsk: 'Confirm it, or leave it to the next session that takes work in this space.',
        emptyAsk: 'Confirm it, or leave it open.',
        cancelled: 'Cancelled:',
        moved_out: 'Moved out:',
        steps: 'Its conditions:',
        noSteps: 'It has no conditions: check what was done against its description.',
        hidden:
          '({n} more line not shown: see the card) | ({n} more lines not shown: see the card)',
      },
      steps_asked: {
        goal: 'An agent changes the conditions of this goal.',
        stage: 'An agent changes the conditions of this stage.',
        ask: 'Allow it, or keep the conditions as they are?',
        removed: 'remove «{text}»',
        reason: 'Its reason: {reason}',
      },
      group_asked: 'Group of {n} item | Group of {n} items',
    },
    decision: {
      accepted: 'accepted {reference}',
      accepted_under: 'accepted {reference} under {under}',
      accepted_label: 'accepted {reference} by the label {label}',
      moved: 'moved {reference} under {under}',
      cancelled: 'cancel {reference}',
      cancelled_following: 'cancel {reference} following question {question}',
      closed: 'close {reference}',
      put_off: 'put off {reference} until {until}: {reason}',
      steps: {
        removed: 'removed condition «{before}»',
        rewrote: 'rewrote condition «{before}» → «{after}»',
        clarified: 'clarified condition «{before}» → «{after}»',
      },
      chose: 'chose {labels}',
      group: 'group «{title}»: {answer} {count}',
      answers: { do: 'do', later: 'later', drop: 'drop' },
      items: '{n} item | {n} items',
    },
    until: {
      comments: '{n} new comment | {n} new comments',
      either: '{until} or {comments}, whichever comes first',
    },
  },
  ru: {
    question: {
      task_filed:
        'Агент добавляет эту задачу в {goal}. Делать, позже, вынести из цели или не делать?',
      task_moved_in:
        'Агент переносит эту задачу в {goal}. Делать, позже, оставить где была или не делать?',
      task_moved_to:
        'Агент переводит эту задачу из {goal} в состояние «{state}». Делать и перевести, позже, вынести из цели или не делать?',
      goal_proposed: 'Агент предлагает эту цель. Делать, позже или не делать?',
      goal_came_back: 'Цель вернулась после того, как её отложили. Делать, позже или не делать?',
      put_off_asked: {
        goal: 'Агент откладывает эту принятую цель до {until}. Делать, позже или не делать? Причина: {reason}',
        stage:
          'Агент откладывает этот принятый этап до {until}. Делать, позже или не делать? Причина: {reason}',
      },
      put_off_came: {
        until: 'Отложено до {until}, и этот срок настал. Делать, позже или не делать?',
        item: 'Отложено до закрытия {item}, и это время настало. Делать, позже или не делать?',
        comments: 'Отложено до {comments}, и это условие выполнено. Делать, позже или не делать?',
      },
      cancel_asked: {
        cancel_outside: 'Агент отменяет эту работу, заведённую вне его собственной.',
        cancel_shared: 'Агент отменяет эту работу, а над ней работают и другие сессии.',
        reason: 'Причина: {reason}',
        sessions: 'Сессии тоже спрошены, их ответы появятся здесь.',
        objects: '{session} возражает: {reason}',
        unanswered: 'Не все сессии ответили за сутки; не ответили: {sessions}.',
        ask: 'Отменить или оставить?',
      },
      cancel_consent: {
        head: 'Агент другой сессии отменяет эту работу, в которой вы участвуете.',
        reason: 'Причина: {reason}',
        ask: 'Ответьте agree, возразите с причиной или вынесите свою работу через move_out и ответьте moved_out.',
      },
      confirm: {
        asked:
          'Вся работа внутри закрыта: подтвердить или оставить следующей сессии, которая возьмёт работу в этом пространстве?',
        agent: 'Агент подтверждает: вся работа внутри закрыта',
        agent_empty: 'Агент закрывает, хотя внутри нет работы',
        summary: ', итог агента: {summary}',
        agentAsk:
          'Подтвердить или оставить следующей сессии, которая возьмёт работу в этом пространстве?',
        emptyAsk: 'Подтвердить или оставить открытой?',
        cancelled: 'Отменено:',
        moved_out: 'Вынесено:',
        steps: 'Условия:',
        noSteps: 'Условий нет: сверьте сделанное с описанием.',
        hidden:
          '(не показана ещё {n} строка: см. карточку) | (не показаны ещё {n} строки: см. карточку) | (не показано ещё {n} строк: см. карточку)',
      },
      steps_asked: {
        goal: 'Агент меняет условия этой цели.',
        stage: 'Агент меняет условия этого этапа.',
        ask: 'Разрешить или оставить условия как есть?',
        removed: 'снять «{text}»',
        reason: 'Причина: {reason}',
      },
      group_asked: 'Группа находок ({n})',
    },
    decision: {
      accepted: 'принято: {reference}',
      accepted_under: 'принято: {reference} в {under}',
      accepted_label: 'принято: {reference} по метке «{label}»',
      moved: 'перенесено: {reference} в {under}',
      cancelled: 'отмена {reference}',
      cancelled_following: 'отмена {reference} после ответа на вопрос {question}',
      closed: 'закрытие {reference}',
      put_off: 'отложено: {reference} до {until}: {reason}',
      steps: {
        removed: 'снято условие «{before}»',
        rewrote: 'переписано условие «{before}» → «{after}»',
        clarified: 'уточнено условие «{before}» → «{after}»',
      },
      chose: 'выбрано: {labels}',
      group: 'группа «{title}»: {answer}, {count}',
      answers: { do: 'делать', later: 'позже', drop: 'не делать' },
      items: '{n} находка | {n} находки | {n} находок',
    },
    until: {
      comments: '{n} нового комментария | {n} новых комментариев | {n} новых комментариев',
      either: '{until} или {comments} — что наступит раньше',
    },
  },
} as const
