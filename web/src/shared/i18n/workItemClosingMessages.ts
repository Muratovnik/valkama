/**
 * What a card says while it closes work or puts it off: the state menu's actions, the window
 * that puts work off, the reason asked in place before a task is cancelled, the window that
 * lists what a goal's cancel closes, the window that confirms a close, the step a former holder
 * marked, and the put-off work's own fact.
 */
export const workItemClosingMessages = {
  en: {
    closeActions: {
      action: {
        defer: 'Put off…',
        cancel: 'Cancel…',
        confirm: 'Confirm close',
      },
      defer: {
        title: 'Put off',
        reason: 'Why it waits',
        reasonMissing: 'Say why it waits: it is read when the work comes back.',
        submit: 'Put off',
        keep: 'Cancel',
      },
      cancelTask: {
        reason: 'Reason',
        question: 'Cancel {reference}? The card closes as «{state}».',
        reasonMissing: 'Say why it is cancelled.',
        confirm: 'Cancel task',
        keep: 'Keep',
      },
      cancelGoal: {
        title: 'Cancel goal',
        titleStage: 'Cancel stage',
        intro: 'Everything open under the goal closes:',
        introStage: 'Everything open under the stage closes:',
        reason: 'Reason',
        reasonMissing: 'Say why it is cancelled: every card under it keeps the reason.',
        dependents: 'Waiting on them',
        waitsOn: 'waits on {reference}',
        waitsDeferred: 'put off until {reference}',
        holder: 'held by {holder}',
        nobody: 'held by nobody',
        changed:
          'The list changed while the window was open: the changed rows are marked. Check it and confirm again.',
        changedRow: 'changed',
        newRow: 'new',
        reading: 'Reading what closes…',
        readFailed: 'What closes could not be read.',
        retry: 'Retry',
        confirm: 'Cancel {n} card | Cancel {n} cards',
        keep: 'Cancel',
      },
      confirm: {
        title: 'Confirm close',
        conditions: 'Conditions of the whole',
        none: 'No conditions: it is checked against its description',
        closed: 'Cancelled and moved out',
        cancelled: 'Cancelled',
        movedOut: 'Moved out',
        reason: '{how} · Reason: {reason}',
        unticked: 'Tick every condition to confirm.',
        submit: 'Confirm',
        keep: 'Cancel',
      },
      mark: {
        confirm: 'Confirm',
        confirmStep: 'Confirm the step {step}',
      },
      deferred: {
        label: 'Put off',
        day: 'until {date}',
        card: 'until {reference} closes',
      },
    },
  },
  ru: {
    closeActions: {
      action: {
        defer: 'Отложить…',
        cancel: 'Отменить…',
        confirm: 'Подтвердить закрытие',
      },
      defer: {
        title: 'Отложить',
        reason: 'Почему ждёт',
        reasonMissing: 'Скажите, почему работа ждёт: это прочтут, когда она вернётся.',
        submit: 'Отложить',
        keep: 'Отмена',
      },
      cancelTask: {
        reason: 'Причина',
        question: 'Отменить {reference}? Карточка закроется как «{state}».',
        reasonMissing: 'Скажите, почему задача отменяется.',
        confirm: 'Отменить задачу',
        keep: 'Отмена',
      },
      cancelGoal: {
        title: 'Отменить цель',
        titleStage: 'Отменить этап',
        intro: 'Закроется всё, что под целью:',
        introStage: 'Закроется всё, что под этапом:',
        reason: 'Причина',
        reasonMissing: 'Скажите, почему отменяете: эту причину сохранит каждая карточка внутри.',
        dependents: 'От них зависят',
        waitsOn: 'ждёт {reference}',
        waitsDeferred: 'отложена до {reference}',
        holder: 'исполнитель: {holder}',
        nobody: 'исполнитель: никто',
        changed:
          'Список изменился, пока окно было открыто: отмечены изменившиеся строки. Проверьте и подтвердите заново.',
        changedRow: 'изменилась',
        newRow: 'новая',
        reading: 'Читается, что закроется…',
        readFailed: 'Не удалось прочитать, что закроется.',
        retry: 'Повторить',
        confirm: 'Отменить {n} карточку | Отменить {n} карточки | Отменить {n} карточек',
        keep: 'Отмена',
      },
      confirm: {
        title: 'Подтвердить закрытие',
        conditions: 'Условия о целом',
        none: 'Условий нет: проверяется по описанию',
        closed: 'Отменённые и вынесенные',
        cancelled: 'Отменено',
        movedOut: 'Вынесено',
        reason: '{how} · Причина: {reason}',
        unticked: 'Отметьте все условия, чтобы подтвердить.',
        submit: 'Подтвердить',
        keep: 'Отмена',
      },
      mark: {
        confirm: 'Подтвердить',
        confirmStep: 'Подтвердить шаг {step}',
      },
      deferred: {
        label: 'Отложено',
        day: 'до {date}',
        card: 'до закрытия {reference}',
      },
    },
  },
} as const
