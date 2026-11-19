/*
 * What the new-task dialog's own fields say: the labels and the parent it searches, the project,
 * the switch that leaves the card unsorted, and why a write failed.
 */

export const workItemComposeMessages = {
  en: {
    compose: {
      labelsHint: 'pick one, or type a new one',
      labelsEmpty: 'No labels yet: type one',
      addLabel: 'Add “{label}”',
      removeLabel: 'Remove label {label}',
      noGoal: 'No goal',
      parentsEmpty: 'No parent matches',
      project: 'Project',
      anyProject: 'Any project',
      anyProjectWhy: 'A goal or stage names no project: it holds the work of any.',
      triage: 'Into “{state}”',
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
      project: 'Проект',
      anyProject: 'Любой проект',
      anyProjectWhy: 'Цель или этап не называет проекта: в них работа любых проектов.',
      triage: 'В «{state}»',
      refused: 'Работа не создана: {reason}',
      noAnswer: 'Работа не создана: сервер не ответил. Введённое сохранено — попробуйте ещё раз.',
      failed: 'Работа не создана. Введённое сохранено — попробуйте ещё раз.',
    },
  },
} as const
