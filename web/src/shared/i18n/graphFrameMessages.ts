/* What an epic's frame on the graph says, in both languages. */

export const graphFrameMessages = {
  en: {
    frame: {
      noEpic: 'No epic',
      epic: 'Epic {reference} “{title}”',
      parent: 'Item {reference} “{title}”',
      foldEpic: 'Collapse epic {reference} “{title}”',
      unfoldEpic: 'Expand epic {reference} “{title}”',
      foldParent: 'Collapse item {reference} “{title}”',
      unfoldParent: 'Expand item {reference} “{title}”',
      foldNone: 'Collapse the work under no epic',
      unfoldNone: 'Expand the work under no epic',
      doneOf: '{done} of {total} done',
      noTasks: 'No tasks',
      review: 'in review',
      active: 'in progress',
      blocked: 'blocked',
      working: 'working',
    },
  },
  ru: {
    frame: {
      noEpic: 'Без эпика',
      epic: 'Эпик {reference} «{title}»',
      parent: 'Задача {reference} «{title}»',
      foldEpic: 'Свернуть эпик {reference} «{title}»',
      unfoldEpic: 'Развернуть эпик {reference} «{title}»',
      foldParent: 'Свернуть задачу {reference} «{title}»',
      unfoldParent: 'Развернуть задачу {reference} «{title}»',
      foldNone: 'Свернуть работу без эпика',
      unfoldNone: 'Развернуть работу без эпика',
      doneOf: '{done} из {total} выполнено',
      noTasks: 'Нет задач',
      review: 'на проверке',
      active: 'в работе',
      blocked: 'заблокирована | заблокированы | заблокировано',
      working: 'работает | работают | работают',
    },
  },
} as const
