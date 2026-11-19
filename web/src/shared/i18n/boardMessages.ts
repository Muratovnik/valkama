/**
 * What the board says of itself: its columns and lanes, the order of work in them, a
 * column folded to its count, and why a tile the take-next queue would not give is held
 * back.
 *
 * A held-back tile ends its first line with a sign and a word for the reason, as a blocked
 * tile names its blocker; the word is short, the whole sentence its name and hover text.
 * The words follow the server's codes (`withheld`) one by one: a goal or stage over the
 * task may be either, so the words say «выше», over it, rather than naming one of them.
 */
export const boardMessages = {
  en: {
    columnEmpty: 'Nothing here',
    columnFold: {
      fold: 'Fold {state}',
      unfold: 'Unfold {state}',
    },
    lanes: {
      counts: '{closed} of {total} closed',
      fold: 'Fold {lane}',
      unfold: 'Unfold {lane}',
      openGoal: 'Open {reference}',
      openPart: 'Open {reference} · {title}',
      showChain: 'Show the chain of {reference} on the board',
      empty: 'Nothing under it yet.',
      showAll: 'Show all · {count}',
      showFewer: 'Show fewer',
      inState: '{count} in {state}',
      offLeft: 'To the left:',
      offRight: 'To the right:',
    },
    order: {
      hint: 'Arrow keys move focus between work items.',
      moved: '{reference} moved: {position} of {total} in {state}',
    },
    withheld: {
      held: 'The queue does not give it: it or a step of it is held',
      waits: 'The queue does not give it: unfinished work blocks it',
      question: 'The queue does not give it: it waits for the owner’s answer',
      no_start: 'The queue does not give it: its workflow leads nowhere into work from here',
      ancestor_triage: 'The queue does not give it: a goal or stage over it is in triage',
      ancestor_deferred: 'The queue does not give it: a goal or stage over it is put off',
      ancestor_cancelling:
        'The queue does not give it: a cancel of a goal or stage over it waits for an answer',
      ancestor_waits: 'The queue does not give it: unfinished work blocks a goal or stage over it',
      ancestor_closed: 'The queue does not give it: a goal or stage over it is closed',
      queue_off: 'The queue does not give it: the owner hands out work in this space by hand',
      outside_space: 'This space’s queue does not give it: it lies in another space',
    },
    withheldShort: {
      held: 'held',
      waits: 'blocked',
      question: 'awaits answer',
      no_start: 'cannot start',
      ancestor_triage: 'triage above',
      ancestor_deferred: 'put off above',
      ancestor_cancelling: 'cancel above',
      ancestor_waits: 'blocked above',
      ancestor_closed: 'closed above',
      queue_off: 'by hand',
      outside_space: 'other space',
    },
  },
  ru: {
    columnEmpty: 'Пусто',
    columnFold: {
      fold: 'Свернуть «{state}»',
      unfold: 'Раскрыть «{state}»',
    },
    lanes: {
      counts: 'закрыто {closed} из {total}',
      fold: 'Свернуть «{lane}»',
      unfold: 'Развернуть «{lane}»',
      openGoal: 'Открыть {reference}',
      openPart: 'Открыть {reference} · {title}',
      showChain: 'Показать цепочку {reference} на доске',
      empty: 'Внутри пока нет задач.',
      showAll: 'Показать все · {count}',
      showFewer: 'Свернуть',
      inState: '{count} в «{state}»',
      offLeft: 'Левее:',
      offRight: 'Правее:',
    },
    order: {
      hint: 'Стрелки переводят фокус между задачами.',
      moved: '{reference}: {position} из {total} в «{state}»',
    },
    withheld: {
      held: 'Очередь её не выдаёт: её или её условие держат',
      waits: 'Очередь её не выдаёт: её блокирует незаконченная работа',
      question: 'Очередь её не выдаёт: она ждёт ответа владельца',
      no_start: 'Очередь её не выдаёт: процесс не ведёт отсюда в работу',
      ancestor_triage: 'Очередь её не выдаёт: цель или этап над ней не разобраны',
      ancestor_deferred: 'Очередь её не выдаёт: цель или этап над ней отложены',
      ancestor_cancelling: 'Очередь её не выдаёт: отмена цели или этапа над ней ждёт ответа',
      ancestor_waits: 'Очередь её не выдаёт: цель или этап над ней ждут другую работу',
      ancestor_closed: 'Очередь её не выдаёт: цель или этап над ней закрыты',
      queue_off: 'Очередь её не выдаёт: владелец раздаёт работу в этом пространстве вручную',
      outside_space: 'Очередь этого пространства её не выдаёт: она из другого пространства',
    },
    withheldShort: {
      held: 'занята',
      waits: 'ждёт',
      question: 'ждёт ответа',
      no_start: 'не начать',
      ancestor_triage: 'не разобрано выше',
      ancestor_deferred: 'отложено выше',
      ancestor_cancelling: 'отмена выше',
      ancestor_waits: 'ждёт выше',
      ancestor_closed: 'закрыто выше',
      queue_off: 'вручную',
      outside_space: 'другое пространство',
    },
  },
}
