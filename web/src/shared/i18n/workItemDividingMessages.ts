/**
 * What a card says while it changes what work is part of: the «…» menu's actions, the window
 * that splits a part off a task, the questions asked in place before work is converted or moved
 * out of its goal, and where the conditions that left a task went.
 */
export const workItemDividingMessages = {
  en: {
    dividing: {
      action: {
        split: 'Split off a part…',
        toStage: 'Turn into a stage',
        toGoal: 'Turn into a goal',
        toTask: 'Return to a task',
        moveOut: 'Move out of the goal…',
      },
      split: {
        title: 'Split off a part',
        intro:
          'A new card stands beside the task, under the same parent and accepted as it is, and takes the conditions chosen.',
        name: 'Title',
        conditions: 'Conditions that go to the new card',
        untitled: 'Name the new card.',
        unchosen: 'Choose a condition: a part takes at least one.',
        submit: 'Create',
        keep: 'Cancel',
      },
      convert: {
        goal: 'Turn {reference} into a goal? Its number, title, description, discussion, history, links, references and conditions with their ticks stay.',
        stage:
          'Turn {reference} into a stage? Its number, title, description, discussion, history, links, references and conditions with their ticks stay.',
        held: 'Its claims end, and the work they hold becomes a new task inside it.',
        projects: 'Its projects are dropped: the tasks inside carry projects.',
        keep: 'Cancel',
      },
      toTask: {
        goal: 'Return goal {reference} to a task? Nothing is inside.',
        stage:
          'Return stage {reference} to a task? Nothing is inside; its goal and its place in it stay.',
        confirm: 'Return to a task',
        keep: 'Cancel',
      },
      moveOut: {
        reason: 'Reason',
        question: 'Move {reference} out of {parent}? The card goes to the top level, to «{state}».',
        questionPlain: 'Move {reference} out of {parent}? The card goes to the top level.',
        reasonMissing: 'Say why it leaves: {parent} keeps the reason.',
        confirm: 'Move out',
        keep: 'Cancel',
      },
      moved: {
        title: 'Conditions moved to',
        count: '{n} condition | {n} conditions',
      },
    },
  },
  ru: {
    dividing: {
      action: {
        split: 'Отделить часть…',
        toStage: 'Превратить в этап',
        toGoal: 'Превратить в цель',
        toTask: 'Вернуть в задачу',
        moveOut: 'Вынести из цели…',
      },
      split: {
        title: 'Отделить часть',
        intro:
          'Новая карточка встанет рядом с задачей, под тем же родителем, принятая так же, и возьмёт выбранные условия.',
        name: 'Название',
        conditions: 'Условия, которые уйдут в новую карточку',
        untitled: 'Назовите новую карточку.',
        unchosen: 'Выберите условие: часть берёт хотя бы одно.',
        submit: 'Создать',
        keep: 'Отмена',
      },
      convert: {
        goal: 'Превратить {reference} в цель? Останутся номер, название, описание, обсуждение, история, связи, ссылки и условия с отметками.',
        stage:
          'Превратить {reference} в этап? Останутся номер, название, описание, обсуждение, история, связи, ссылки и условия с отметками.',
        held: 'Захваты снимаются, а начатое под ними станет новой задачей внутри.',
        projects: 'Проекты задачи снимаются: проекты несут задачи внутри.',
        keep: 'Отмена',
      },
      toTask: {
        goal: 'Вернуть цель {reference} в задачу? Внутри ничего нет.',
        stage:
          'Вернуть этап {reference} в задачу? Внутри ничего нет; цель и место в ней останутся.',
        confirm: 'Вернуть в задачу',
        keep: 'Отмена',
      },
      moveOut: {
        reason: 'Причина',
        question:
          'Вынести {reference} из {parent}? Карточка встанет на верхний уровень, в «{state}».',
        questionPlain: 'Вынести {reference} из {parent}? Карточка встанет на верхний уровень.',
        reasonMissing: 'Скажите, почему карточка уходит: {parent} сохранит причину.',
        confirm: 'Вынести',
        keep: 'Отмена',
      },
      moved: {
        title: 'Условия ушли в',
        count: '{n} условие | {n} условия | {n} условий',
      },
    },
  },
} as const
