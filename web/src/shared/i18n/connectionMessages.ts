/**
 * The words for a lost connection to the local service: what the rail's
 * connection control says while the app reconnects, and the reason a read
 * that never reached the service gives. Both lead with the same fact, so the
 * card that could not be read and the rail say one thing.
 *
 * Beside them, the one read the service reached and could not answer: a card in
 * an attached store another build wrote. Such a store is read as it is and never
 * upgraded, so the reader is told why and offered no retry that would find the same.
 */
export const connectionMessages = {
  en: {
    connection: {
      lost: 'No connection to the local service. Valkama reconnects by itself; until then it shows what it last received.',
      readFailed: 'No connection to the local service. Retry once it is back.',
    },
    attachedStore: {
      schemaMismatch:
        'This space is in an attached store written by another version of Valkama. An attached store is never upgraded, so its cards cannot be read here. They open once the store and this Valkama are on the same version.',
    },
  },
  ru: {
    connection: {
      lost: 'Нет связи с локальным сервисом. Valkama переподключится сама, а пока показывает то, что получила последним.',
      readFailed: 'Нет связи с локальным сервисом. Повторите, когда связь вернётся.',
    },
    attachedStore: {
      schemaMismatch:
        'Это пространство лежит в подключённом хранилище, которое записала другая версия Valkama. Подключённое хранилище не обновляется, поэтому его карточки здесь не читаются. Они откроются, когда хранилище и Valkama будут одной версии.',
    },
  },
} as const
