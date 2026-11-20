/**
 * The words of the texts the service composes, said from their key and values
 * (`shared/api/composedTextModel.ts`): the prompts of the questions it asks and what the
 * summary of agent decisions says was decided. Each English line says what the service's own
 * English text says, in the interface's words: a step of a goal or stage is a condition, as
 * everywhere on the screen. A title, a reason, a summary and a condition's text are the agent's
 * words and come in as values, as written. `composedText.ts` puts the lines together.
 */
export const composedTextMessages = {
  en: {
    question: {
      task_filed:
        'An agent files the task {reference} in {goal}: {title} Take it on, put it off, move it out of the goal, or drop it.',
      task_moved_in:
        'An agent moves the task {reference} into {goal}: {title} Take it on, put it off, leave it where it was, or drop it.',
      task_moved_to:
        'An agent moves the task {reference}, lying in {goal}, to {state}: {title} Take it on and move it there, put it off, move it out of the goal, or drop it.',
      goal_proposed:
        'An agent proposes the goal {reference}: {title} Take it on, put it off, or drop it.',
      goal_came_back:
        'The goal {reference} came back from being put off: {title} Take it on, put it off, or drop it.',
      put_off_asked: {
        goal: 'An agent puts off {reference}, an accepted goal: {title} Until {until}. Its reason: {reason} Keep it, put it off, or drop it.',
        stage:
          'An agent puts off {reference}, an accepted stage: {title} Until {until}. Its reason: {reason} Keep it, put it off, or drop it.',
      },
      put_off_came: {
        until:
          '{reference} was put off until {until}; that has come. Do it, put it off again, or drop it.',
        item: '{reference} was put off until {item} closed; that has come. Do it, put it off again, or drop it.',
      },
      cancel_asked: {
        cancel_outside: 'An agent cancels {reference}, filed outside its own work: {title}',
        cancel_shared: 'An agent cancels {reference}, which other sessions work on: {title}',
        reason: 'Its reason: {reason}',
        sessions: 'The sessions are asked as well, and their answers show here.',
        objects: '{session} objects: {reason}',
        unanswered: 'Not every session answered within a day: {sessions} did not.',
        ask: 'Cancel it, or keep it.',
      },
      cancel_consent: {
        head: "Another session's agent cancels {reference}, work you take part in: {title}",
        reason: 'Its reason: {reason}',
        ask: 'Answer agree, object with a reason, or move your work out of it with move_out and answer moved_out.',
      },
      confirm: {
        asked:
          'All work under {reference} is closed: confirm it, or leave it to the next session that takes work in this space.',
        agent: 'An agent confirms {reference}: all work under it is closed',
        agent_empty: 'An agent closes {reference}, which has nothing under it',
        summary: ', and its summary says: {summary}',
        agentAsk: 'Confirm it, or leave it to the next session that takes work in this space.',
        emptyAsk: 'Confirm it, or leave it open.',
        cancelled: 'Cancelled:',
        moved_out: 'Moved out:',
        steps: 'Its conditions:',
        noSteps: 'It has no conditions: check what was done against its description.',
        hidden:
          '({n} more line not shown: see {reference}) | ({n} more lines not shown: see {reference})',
      },
      steps_asked: {
        goal: 'An agent changes the conditions of {reference}, a goal: {title}',
        stage: 'An agent changes the conditions of {reference}, a stage: {title}',
        removed: 'remove «{text}»',
        reason: 'Its reason: {reason} Allow it, or keep the conditions as they are.',
      },
      group_asked: 'Group of {n} item: «{title}» | Group of {n} items: «{title}»',
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
  },
  ru: {
    question: {
      task_filed:
        'Агент добавляет задачу {reference} в {goal}: {title} Делать, отложить, вынести из цели или не делать?',
      task_moved_in:
        'Агент переносит задачу {reference} в {goal}: {title} Делать, отложить, оставить где была или не делать?',
      task_moved_to:
        'Агент переводит задачу {reference} из {goal} в состояние «{state}»: {title} Делать и перевести, отложить, вынести из цели или не делать?',
      goal_proposed: 'Агент предлагает цель {reference}: {title} Делать, отложить или не делать?',
      goal_came_back:
        'Цель {reference} вернулась после того, как её отложили: {title} Делать, отложить или не делать?',
      put_off_asked: {
        goal: 'Агент откладывает принятую цель {reference}: {title} До {until}. Причина: {reason} Оставить, отложить или не делать?',
        stage:
          'Агент откладывает принятый этап {reference}: {title} До {until}. Причина: {reason} Оставить, отложить или не делать?',
      },
      put_off_came: {
        until:
          '{reference} отложили до {until}, и этот срок настал. Делать, отложить снова или не делать?',
        item: '{reference} отложили до закрытия {item}, и это время настало. Делать, отложить снова или не делать?',
      },
      cancel_asked: {
        cancel_outside: 'Агент отменяет {reference} (заведено вне его собственной работы): {title}',
        cancel_shared: 'Агент отменяет {reference} (над этим работают и другие сессии): {title}',
        reason: 'Причина: {reason}',
        sessions: 'Сессии тоже спрошены, их ответы появятся здесь.',
        objects: '{session} возражает: {reason}',
        unanswered: 'Не все сессии ответили за сутки; не ответили: {sessions}.',
        ask: 'Отменить или оставить?',
      },
      cancel_consent: {
        head: 'Агент другой сессии отменяет {reference} — работу, в которой вы участвуете: {title}',
        reason: 'Причина: {reason}',
        ask: 'Ответьте agree, возразите с причиной или вынесите свою работу через move_out и ответьте moved_out.',
      },
      confirm: {
        asked:
          'Вся работа под {reference} закрыта: подтвердить или оставить следующей сессии, которая возьмёт работу в этом пространстве?',
        agent: 'Агент подтверждает {reference}: вся работа внутри закрыта',
        agent_empty: 'Агент закрывает {reference}: внутри нет работы',
        summary: ', итог агента: {summary}',
        agentAsk:
          'Подтвердить или оставить следующей сессии, которая возьмёт работу в этом пространстве?',
        emptyAsk: 'Подтвердить или не закрывать?',
        cancelled: 'Отменено:',
        moved_out: 'Вынесено:',
        steps: 'Условия:',
        noSteps: 'Условий нет: сверьте сделанное с описанием.',
        hidden:
          '(не показана ещё {n} строка: см. {reference}) | (не показаны ещё {n} строки: см. {reference}) | (не показано ещё {n} строк: см. {reference})',
      },
      steps_asked: {
        goal: 'Агент меняет условия цели {reference}: {title}',
        stage: 'Агент меняет условия этапа {reference}: {title}',
        removed: 'снять «{text}»',
        reason: 'Причина: {reason} Разрешить или оставить условия как есть?',
      },
      group_asked: 'Группа находок ({n}): «{title}»',
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
  },
} as const
