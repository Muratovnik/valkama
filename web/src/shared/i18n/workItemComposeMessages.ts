/* What the new-task dialog's searching fields say, the labels and the parent, and why a write failed. */

export const workItemComposeMessages = {
  en: {
    compose: {
      labelsHint: 'pick one, or type a new one',
      labelsEmpty: 'No labels yet: type one',
      addLabel: 'Add “{label}”',
      removeLabel: 'Remove label {label}',
      noGoal: 'No goal',
      parentsEmpty: 'No parent matches',
      refused: 'The work was not created: {reason}',
      noAnswer:
        'The work was not created: the server did not answer. What you typed is kept; try again.',
      failed: 'The work was not created. What you typed is kept; try again.',
    },
  },
  ru: {
    compose: {
      labelsHint: 'выберите или введите новую',
      labelsEmpty: 'Меток пока нет: введите новую',
      addLabel: 'Добавить «{label}»',
      removeLabel: 'Убрать метку {label}',
      noGoal: 'Без цели',
      parentsEmpty: 'Такого родителя нет',
      refused: 'Работа не создана: {reason}',
      noAnswer: 'Работа не создана: сервер не ответил. Введённое сохранено — попробуйте ещё раз.',
      failed: 'Работа не создана. Введённое сохранено — попробуйте ещё раз.',
    },
  },
} as const
