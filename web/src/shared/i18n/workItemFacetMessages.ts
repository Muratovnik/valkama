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
      asked: 'Waiting for my answer',
      // A card of the space's triage stack no review has marked, as «time to triage» counts it.
      triage: 'Awaiting triage',
      elsewhere: 'From another space',
      notElsewhere: 'Not from another space',
      heldBy: 'Held by {holder}',
      heldStale: 'Held by {holder} — the claim is stale',
      heldWorking: 'Held by {holder} — working on it',
      heldElsewhere: 'Held by {holder} — working on other items',
      heldAsking: 'Held by {holder} — asking a person for a permission or an answer',
      heldWaiting: 'Held by {holder} — waiting for a person',
      waiting: 'Waiting on {reference}',
      // An executor's sign, named by its client wherever it stands: a tile, a card's holder.
      client: {
        claude: 'Claude Code',
        codex: 'Codex',
        other: 'Another client',
      },
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
      triage: 'Triage',
      deferred: 'Deferred',
      ready: 'Ready',
      active: 'In progress',
      review: 'Review',
      completed: 'Done',
      blocked: 'Blocked',
      cancelled: 'Cancelled',
    },
    // What an accepted open goal or stage derives from the work under it.
    containerState: {
      not_started: 'Not started',
      in_progress: 'In progress',
      awaiting_confirmation: 'Awaiting confirmation',
    },
    // The standard workflow's states by key, in the words of their categories.
    stateName: {
      triage: 'Triage',
      deferred: 'Deferred',
      ready: 'Ready',
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
      asked: 'Ждёт моего ответа',
      triage: 'Ждёт разбора',
      elsewhere: 'Из другого пространства',
      notElsewhere: 'Не из другого пространства',
      heldBy: 'Держит {holder}',
      heldStale: 'Держит {holder} — захват устарел',
      heldWorking: 'Держит {holder} — работает над ней',
      heldElsewhere: 'Держит {holder} — работает над другими задачами',
      heldAsking: 'Держит {holder} — спрашивает человека: ждёт разрешения или ответа',
      heldWaiting: 'Держит {holder} — ждёт человека',
      waiting: 'Ждёт {reference}',
      client: {
        claude: 'Claude Code',
        codex: 'Codex',
        other: 'Другой клиент',
      },
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
      triage: 'Не разобрано',
      deferred: 'Отложено',
      ready: 'Готово к работе',
      active: 'В работе',
      review: 'Проверка',
      completed: 'Выполнено',
      blocked: 'Заблокировано',
      cancelled: 'Отменено',
    },
    containerState: {
      not_started: 'Не начато',
      in_progress: 'В работе',
      awaiting_confirmation: 'Ждёт подтверждения',
    },
    stateName: {
      triage: 'Не разобрано',
      deferred: 'Отложено',
      ready: 'Готово к работе',
      dev: 'В работе',
      review: 'Проверка',
      done: 'Выполнено',
      blocked: 'Заблокировано',
      cancelled: 'Отменено',
    },
  },
} as const
