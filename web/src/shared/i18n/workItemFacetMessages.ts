/**
 * What a work item's facets say, wherever a surface prints them.
 *
 * Readiness has one label everywhere. It had three: «Готово к работе» in the
 * queue, which also reads as "done", «можно брать» on a tile and «Можно брать
 * сейчас» on the graph. An open blocker is «Ждёт MAIN-12», which names what it
 * waits on; the tile used to say «заблокировано», the word the queue used for
 * a state category, so one word meant two predicates.
 */
export const workItemFacetMessages = {
  en: {
    facet: {
      ready: 'Workable',
      held: 'Has an assignee',
      heldBy: 'Held by {holder}',
      heldStale: 'Held by {holder} — the claim is stale',
      heldWorking: 'Held by {holder} — working on it',
      heldElsewhere: 'Held by {holder} — working on other items',
      heldWaiting: 'Held by {holder} — waiting for a person',
      waiting: 'Waiting on {reference}',
      steps: '{done}/{total}',
      moreLabels: '+{count}',
      filterAdd: 'Filter: {facet} {value}',
      filterRemove: 'Remove from filter: {facet} {value}',
      name: {
        kind: 'kind',
        priority: 'priority',
        labels: 'label',
      },
    },
    category: {
      backlog: 'Backlog',
      queued: 'Queued',
      active: 'In progress',
      review: 'Review',
      completed: 'Done',
      blocked: 'Blocked',
      cancelled: 'Cancelled',
    },
    // The standard workflow's states by key, in the words of their categories.
    stateName: {
      backlog: 'Backlog',
      todo: 'Queued',
      dev: 'In progress',
      review: 'Review',
      done: 'Done',
      blocked: 'Blocked',
      cancelled: 'Cancelled',
    },
  },
  ru: {
    facet: {
      ready: 'Можно брать',
      held: 'Есть исполнитель',
      heldBy: 'Держит {holder}',
      heldStale: 'Держит {holder} — захват устарел',
      heldWorking: 'Держит {holder} — работает над ней',
      heldElsewhere: 'Держит {holder} — работает над другими задачами',
      heldWaiting: 'Держит {holder} — ждёт человека',
      waiting: 'Ждёт {reference}',
      steps: '{done}/{total}',
      moreLabels: '+{count}',
      filterAdd: 'Фильтр: {facet} {value}',
      filterRemove: 'Убрать из фильтра: {facet} {value}',
      name: {
        kind: 'тип',
        priority: 'приоритет',
        labels: 'метка',
      },
    },
    category: {
      backlog: 'Бэклог',
      queued: 'К работе',
      active: 'В работе',
      review: 'Проверка',
      completed: 'Выполнено',
      blocked: 'Заблокировано',
      cancelled: 'Отменено',
    },
    stateName: {
      backlog: 'Бэклог',
      todo: 'К работе',
      dev: 'В работе',
      review: 'Проверка',
      done: 'Выполнено',
      blocked: 'Заблокировано',
      cancelled: 'Отменено',
    },
  },
} as const
