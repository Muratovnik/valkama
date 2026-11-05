/**
 * The side panel's list of work going on now, its phone panel, and the pin that keeps
 * an item in it. A row's state is said in the words a card's foot uses for it.
 */
export const liveWorkMessages = {
  en: {
    liveWork: {
      title: 'Work',
      list: 'Work going on now',
      group: 'Work under {name}',
      space: '{key} · {name}',
      empty: 'Nobody is working right now',
      unplaced: 'no task · {count} agent | no task · {count} agents',
      elsewhere: 'Outside spaces · {count} agent | Outside spaces · {count} agents',
      agents: '{count} agent | {count} agents',
      working: 'working',
      held: 'held by a session',
      waiting: 'waiting',
      quiet: 'silent since {since}',
      idle: 'Pinned · no work now · {state}',
      closed: 'Pinned · {state}',
      ended: 'work ended',
      noProject: 'No project binds this space, so it has no board to open',
      open: 'Work going on now: {count}',
      close: 'Close',
      pin: 'Pin to Work',
      unpin: 'Pinned to Work: press to remove the pin',
      pinned: '{reference} pinned to Work',
      unpinned: 'Pin removed from {reference}',
      pinFailed: 'The pin could not be changed',
    },
  },
  ru: {
    liveWork: {
      title: 'Работа',
      list: 'Работа сейчас',
      group: 'Работа в {name}',
      space: '{key} · {name}',
      empty: 'Сейчас никто не работает',
      unplaced:
        'без задачи · {count}\u{A0}агент | без задачи · {count}\u{A0}агента | без задачи · {count}\u{A0}агентов',
      elsewhere:
        'Вне пространств · {count}\u{A0}агент | Вне пространств · {count}\u{A0}агента | Вне пространств · {count}\u{A0}агентов',
      agents: '{count}\u{A0}агент | {count}\u{A0}агента | {count}\u{A0}агентов',
      working: 'работает',
      held: 'у сессии',
      waiting: 'ждёт',
      quiet: 'молчит с {since}',
      idle: 'Закреплена · сейчас работы нет · {state}',
      closed: 'Закреплена · {state}',
      ended: 'работа закончилась',
      noProject: 'Пространство не привязано к проекту, и доски у него нет',
      open: 'Работа сейчас: {count}',
      close: 'Закрыть',
      pin: 'Закрепить в «Работе»',
      unpin: 'Закреплена в «Работе»: нажмите, чтобы открепить',
      pinned: '{reference} закреплена в «Работе»',
      unpinned: 'Закрепление {reference} снято',
      pinFailed: 'Закрепление не изменилось',
    },
  },
}
