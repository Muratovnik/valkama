export const workItemLinkMessages = {
  en: {
    workItemLink: {
      contextTitle: 'Task link',
      malformed: {
        title: 'This link does not name a task',
        description:
          '“{text}” is not a task number. A task number is a space key, a dash and a number, like MAIN-12.',
        empty: 'The address stops before the number. A task link ends with a number like MAIN-12.',
      },
      noSpace: {
        title: 'There is no space {space}',
        description:
          'No project in this Valkama has a space with that key, so {reference} cannot be opened here. The link may come from another installation.',
      },
      noItem: {
        title: 'There is no task {reference}',
        description:
          'Space {space} has no task with that number: it was deleted, or the number is mistyped.',
      },
      unreadable:
        'Space {space} cannot be read right now, so {reference} cannot be opened. Its store may be detached or busy: try again in a moment.',
      failed: 'Valkama could not check this link. Try again in a moment.',
      openSpace: 'Open space {space}',
    },
  },
  ru: {
    workItemLink: {
      contextTitle: 'Ссылка на задачу',
      malformed: {
        title: 'В этой ссылке нет номера задачи',
        description:
          '«{text}» не похоже на номер задачи. Номер состоит из ключа пространства, дефиса и числа, например MAIN-12.',
        empty:
          'Адрес обрывается перед номером. Ссылка на задачу заканчивается номером, например MAIN-12.',
      },
      noSpace: {
        title: 'Пространства {space} нет',
        description:
          'Ни в одном проекте этой Valkama нет пространства с таким ключом, поэтому {reference} здесь не открыть. Возможно, ссылка из другой установки.',
      },
      noItem: {
        title: 'Задачи {reference} нет',
        description:
          'В пространстве {space} нет задачи с таким номером: её удалили, или в номере ошибка.',
      },
      unreadable:
        'Пространство {space} сейчас не читается, поэтому {reference} не открыть. Возможно, его хранилище отключено или занято: повторите чуть позже.',
      failed: 'Valkama не смогла проверить ссылку. Повторите чуть позже.',
      openSpace: 'Открыть пространство {space}',
    },
  },
}
