/*
 * The kind of each participation point an agent's own decision is marked at, one word for it
 * wherever it is said: the point filter of Agent decisions, its table, and the mark on the event
 * in a card's System events.
 */

export const decisionPointMessages = {
  en: {
    finding: 'Finding outside the goal',
    proposed_goal: 'Goal the agent proposed',
    task_in_goal: 'Task in an accepted goal',
    decision: 'Choice of a solution',
    cancel_outside: 'Cancel outside the current work',
    cancel_shared: 'Cancel of work others do',
    condition: 'Condition changed',
    goal_close: 'Goal closed',
    goal_defer: 'Goal or stage put off',
    assignment: 'Work taken by assignment',
  },
  ru: {
    finding: 'Находка вне цели',
    proposed_goal: 'Цель, предложенная агентом',
    task_in_goal: 'Задача в принятой цели',
    decision: 'Выбор решения',
    cancel_outside: 'Отмена вне текущей работы',
    cancel_shared: 'Отмена работы других',
    condition: 'Изменение условия',
    goal_close: 'Закрытие цели',
    goal_defer: 'Отложена цель или этап',
    assignment: 'Принято по поручению',
  },
}
