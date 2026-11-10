/**
 * The side panel's list of work going on now, its phone panel, and the pin that keeps
 * an item in it. A row's state is said in one word on its second line (`doing`), and in its
 * hint with what it means (`means`); each fold is named by what it holds. The word for a
 * state is the one a card's foot and the graph's key use, so a held item is «у сессии»
 * wherever it is said.
 */
export const liveWorkMessages = {
  en: {
    liveWork: {
      title: 'Work',
      list: 'Work going on now',
      group: 'Work under {name}',
      space: '{key} · {name}',
      empty: 'Nobody is working right now',
      heldMore: '{count} more with a working session | {count} more with working sessions',
      longMore: '{count} more waiting for hours',
      quietMore: '{count} more silent for over a day',
      elsewhere: 'Sessions outside any space',
      pinnedGroup: 'Pinned',
      partOf: 'part of {title}',
      agents: '{count} agent | {count} agents',
      doing: { working: 'working', asks: 'asking', waiting: 'waiting', held: 'held' },
      during: '{state} for {span}',
      means: {
        working: '{state}',
        asks: '{state} — the session stopped in the middle of a turn for a permission or an answer',
        waiting: '{state} — the session’s turn is over',
        held: '{state} — its session is at work on another item',
      },
      quiet: 'silent since {since}',
      session: 'Session “{name}”',
      sessionIn: 'Session “{name}” in {folder}',
      sessionAt: 'Session in {folder}',
      unnamed: 'Unnamed session',
      openSession: 'Open the session of {reference} {title}',
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
      heldMore:
        'ещё {count}\u{A0}у работающей сессии | ещё {count}\u{A0}у работающих сессий | ещё {count}\u{A0}у работающих сессий',
      longMore:
        'ещё {count}\u{A0}давно ждёт | ещё {count}\u{A0}давно ждут | ещё {count}\u{A0}давно ждут',
      quietMore:
        'ещё {count}\u{A0}молчит больше суток | ещё {count}\u{A0}молчат больше суток | ещё {count}\u{A0}молчат больше суток',
      elsewhere: 'Сессии вне пространств',
      pinnedGroup: 'Закреплённые',
      partOf: 'часть «{title}»',
      agents: '{count}\u{A0}агент | {count}\u{A0}агента | {count}\u{A0}агентов',
      doing: { working: 'работает', asks: 'спрашивает', waiting: 'ждёт', held: 'у сессии' },
      during: '{state} уже {span}',
      means: {
        working: '{state}',
        asks: '{state} — сессия остановилась посреди хода: ей нужно разрешение или ответ',
        waiting: '{state} — ход сессии закончен',
        held: '{state} — сессия сейчас работает над другой задачей',
      },
      quiet: 'молчит с {since}',
      session: 'Сессия «{name}»',
      sessionIn: 'Сессия «{name}» в {folder}',
      sessionAt: 'Сессия в {folder}',
      unnamed: 'Сессия без названия',
      openSession: 'Открыть сессию {reference} {title}',
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
