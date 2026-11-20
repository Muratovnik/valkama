import { historyEventMessages } from '@/shared/i18n/historyEventMessages.ts'
import { mentionMessages } from '@/shared/i18n/mentionMessages.ts'

/**
 * The words of the card's history. `activity` names the history actions a locale takes
 * from here in one spread: the label change, the mention, whose words `mentionMessages` owns,
 * and the work model's events, whose words `historyEventMessages` owns.
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
      ownDecision: 'Agent’s own decision · {point}',
      detail: 'Recorded details',
      thread: 'Thread “{thread}”',
      threadDecided: 'Thread “{thread}” · decision: {decision}',
      threadGone: 'A thread no longer on this task',
      question: 'Question “{question}”',
      labelsAdded: 'Added: {labels}',
      labelsRemoved: 'Removed: {labels}',
      labelName: '“{label}”',
      event: historyEventMessages.en.event,
    },
    activity: {
      ...mentionMessages.en.activity,
      ...historyEventMessages.en.activity,
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
      ownDecision: 'Решение агента · {point}',
      detail: 'Записанные подробности',
      thread: 'Ветка «{thread}»',
      threadDecided: 'Ветка «{thread}» · решение: {decision}',
      threadGone: 'Ветка, которой больше нет в этой задаче',
      question: 'Вопрос «{question}»',
      labelsAdded: 'Добавлено: {labels}',
      labelsRemoved: 'Снято: {labels}',
      labelName: '«{label}»',
      event: historyEventMessages.ru.event,
    },
    activity: {
      ...mentionMessages.ru.activity,
      ...historyEventMessages.ru.activity,
      labels_changed: 'Метки изменены',
    },
  },
}
