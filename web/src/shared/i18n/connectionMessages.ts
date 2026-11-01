/**
 * The words for a lost connection to the local service: what the rail's
 * connection control says while the app reconnects, and the reason a read
 * that never reached the service gives. Both lead with the same fact, so the
 * card that could not be read and the rail say one thing.
 */
export const connectionMessages = {
  en: {
    connection: {
      lost: 'No connection to the local service. Valkama reconnects by itself; until then it shows what it last received.',
      readFailed: 'No connection to the local service. Retry once it is back.',
    },
  },
  ru: {
    connection: {
      lost: 'Нет связи с локальным сервисом. Valkama переподключится сама, а пока показывает то, что получила последним.',
      readFailed: 'Нет связи с локальным сервисом. Повторите, когда связь вернётся.',
    },
  },
} as const
