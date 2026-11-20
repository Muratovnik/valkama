/**
 * The words of the work model's history events and of what the service records in their lines:
 * an acceptance and its basis, work put off until a day or a card's close and come back, a
 * triage review's mark, a card that left a goal, a part split off and a card that changed its
 * kind. `activity` names each event by its key, as every other event is named; `event` says the
 * parts of a line whose shape is known, and a line of any other shape is shown as recorded.
 */
export const historyEventMessages = {
  en: {
    activity: {
      accepted: 'Accepted',
      opened: 'Opened for work',
      child_left: 'A card left it',
      awaiting_confirmation: 'Awaiting confirmation',
      returned: 'Came back from being put off',
      converted: 'Kind changed',
      checklist_removed: 'Condition removed',
      split_off: 'A part split off',
      split_from: 'Split off from a card',
      action_dropped: 'A waiting action dropped',
      commit_attached: 'Commit attached',
      commit_detached: 'Commit detached',
      commit_rewritten: 'Commit rewritten',
      triage_seen: 'Triage mark',
    },
    event: {
      byLabel: '{basis} “{label}”',
      why: '{until} — {why}',
      cameDay: 'the day {date} came',
      cameCard: {
        completed: '{reference} is done',
        cancelled: '{reference} is cancelled',
        deleted: '{reference} is deleted',
      },
      seen: 'seen and left as it is',
      cleared: 'mark taken away',
      movedUnder: '{reference} moved under {goal}',
      conditions: '{reference}: {n} condition | {reference}: {n} conditions',
      leftover:
        'the rest went to {reference}: {n} condition | the rest went to {reference}: {n} conditions',
      projectsDropped: 'projects dropped: {projects}',
      claimed: 'claimed',
      launchFailed: 'the launch failed',
      acceptedWith: 'accepted with {reference}',
      duplicateOf: 'a duplicate of {reference}',
      convertedFrom: 'kind before: {kind}',
      movedOut: 'moved out of {reference}: {why}',
    },
  },
  ru: {
    activity: {
      accepted: 'Принято',
      opened: 'Открыта для работы',
      child_left: 'Карточка вышла из состава',
      awaiting_confirmation: 'Ждёт подтверждения',
      returned: 'Вернулась из отложенных',
      converted: 'Тип изменён',
      checklist_removed: 'Условие удалено',
      split_off: 'Отделена часть',
      split_from: 'Отделена от карточки',
      action_dropped: 'Ожидавшее действие отброшено',
      commit_attached: 'Коммит прикреплён',
      commit_detached: 'Коммит откреплён',
      commit_rewritten: 'Коммит переписан',
      triage_seen: 'Отметка разбора',
    },
    event: {
      byLabel: '{basis} «{label}»',
      why: '{until} — {why}',
      cameDay: 'наступило {date}',
      cameCard: {
        completed: '{reference} выполнена',
        cancelled: '{reference} отменена',
        deleted: '{reference} удалена',
      },
      seen: 'просмотрено и оставлено как есть',
      cleared: 'отметка снята',
      movedUnder: '{reference} перенесена в {goal}',
      conditions: '{reference}: {n} условие | {reference}: {n} условия | {reference}: {n} условий',
      leftover:
        'остальное ушло в {reference}: {n} условие | остальное ушло в {reference}: {n} условия | остальное ушло в {reference}: {n} условий',
      projectsDropped: 'сняты проекты: {projects}',
      claimed: 'взята в работу',
      launchFailed: 'запуск не удался',
      acceptedWith: 'принята вместе с {reference}',
      duplicateOf: 'дубликат {reference}',
      convertedFrom: 'прежний тип: {kind}',
      movedOut: 'вынесена из {reference}: {why}',
    },
  },
} as const
