import { mentionMessages } from '@/shared/i18n/mentionMessages.ts'

/**
 * The words of the card's history. `activity` names the history actions a locale takes
 * from here in one spread: the label change, and the mention, whose words
 * `mentionMessages` owns.
 */
export const activityMessages = {
  en: {
    history: {
      search: 'Search',
      category: 'Record category',
      all: 'All records',
      events: 'System events',
      evidence: 'Attached evidence',
      actor: 'Author',
      allActors: 'All authors',
      status: 'Execution status',
      allStatuses: 'All statuses',
      client: 'Client',
      allClients: 'All clients',
      noMatches: 'No matching records',
      reset: 'Clear filters',
      unknownDate: 'Unknown date',
      unknownEvent: 'System event: {action}',
      detail: 'Recorded details',
      thread: 'Thread “{thread}”',
      threadDecided: 'Thread “{thread}” · decision: {decision}',
      threadGone: 'A thread no longer on this task',
      question: 'Question “{question}”',
      labelsAdded: 'Added: {labels}',
      labelsRemoved: 'Removed: {labels}',
      labelName: '“{label}”',
    },
    activity: {
      ...mentionMessages.en.activity,
      labels_changed: 'Labels changed',
    },
  },
  ru: {
    history: {
      search: 'Поиск',
      category: 'Категория записи',
      all: 'Все записи',
      events: 'Системные события',
      evidence: 'Прикреплённые свидетельства',
      actor: 'Автор',
      allActors: 'Все авторы',
      status: 'Статус исполнения',
      allStatuses: 'Все статусы',
      client: 'Клиент',
      allClients: 'Все клиенты',
      noMatches: 'Нет подходящих записей',
      reset: 'Сбросить фильтры',
      unknownDate: 'Дата неизвестна',
      unknownEvent: 'Системное событие: {action}',
      detail: 'Записанные подробности',
      thread: 'Ветка «{thread}»',
      threadDecided: 'Ветка «{thread}» · решение: {decision}',
      threadGone: 'Ветка, которой больше нет в этой задаче',
      question: 'Вопрос «{question}»',
      labelsAdded: 'Добавлено: {labels}',
      labelsRemoved: 'Снято: {labels}',
      labelName: '«{label}»',
    },
    activity: {
      ...mentionMessages.ru.activity,
      labels_changed: 'Метки изменены',
    },
  },
}
