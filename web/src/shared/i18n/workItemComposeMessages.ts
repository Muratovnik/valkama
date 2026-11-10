/* What the new-task dialog's searching fields say: the labels and the parent. */

export const workItemComposeMessages = {
  en: {
    compose: {
      labelsHint: 'pick one, or type a new one',
      labelsEmpty: 'No labels yet: type one',
      addLabel: 'Add “{label}”',
      removeLabel: 'Remove label {label}',
      noParent: 'No parent',
      parentsEmpty: 'No parent matches',
    },
  },
  ru: {
    compose: {
      labelsHint: 'выберите или введите новую',
      labelsEmpty: 'Меток пока нет: введите новую',
      addLabel: 'Добавить «{label}»',
      removeLabel: 'Убрать метку {label}',
      noParent: 'Без родителя',
      parentsEmpty: 'Такого родителя нет',
    },
  },
} as const
