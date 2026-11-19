/**
 * The Work views' menu beside «Kanban / List / Graph»: how the view is grouped and
 * ordered, the names of the groups that makes, the views saved in the space, the note on views this version could not read, and
 * the small dialog that names a new one.
 *
 * The menu's word is short on purpose: it stands on a phone's one row with the
 * view, the filter and the primary action.
 */
export const viewMenuMessages = {
  en: {
    viewMenu: {
      label: 'View',
      grouping: 'Grouping',
      groupNone: 'No grouping',
      groupGoal: 'By goal',
      groupStage: 'By stage',
      groupProject: 'By project',
      sorting: 'Sort',
      sortBy: {
        queue: 'Queue order',
        updated: 'Updated',
        created: 'Created',
        priority: 'Priority',
      },
      direction: 'Direction',
      ascending: {
        queue: 'First in the queue first',
        updated: 'Oldest first',
        created: 'Oldest first',
        priority: 'Lowest first',
        other: 'Ascending',
      },
      descending: {
        queue: 'Last in the queue first',
        updated: 'Newest first',
        created: 'Newest first',
        priority: 'Highest first',
        other: 'Descending',
      },
      saved: 'Saved views',
      save: 'Save view…',
      delete: 'Delete view “{name}”',
      dropped:
        'Removed a view with values this version does not know: {names} | Removed views with values this version does not know: {names}',
      droppedName: '“{name}”',
    },
    grouped: {
      noGoal: 'No goal',
      space: 'Space {key} · {name}',
      severalProjects: 'Several projects',
      noProject: 'No project',
      stage: 'Stage {reference} · {title}',
    },
    saveView: {
      title: 'Save view',
      subtitle:
        'The view, the grouping, the order and the filter, as they are now, for this space.',
      name: 'Name',
      replaces: 'A view of this name is replaced.',
      save: 'Save',
      cancel: 'Cancel',
    },
  },
  ru: {
    viewMenu: {
      label: 'Вид',
      grouping: 'Группировка',
      groupNone: 'Без группировки',
      groupGoal: 'По цели',
      groupStage: 'По этапу',
      groupProject: 'По проекту',
      sorting: 'Сортировка',
      sortBy: {
        queue: 'Порядок очереди',
        updated: 'Обновлено',
        created: 'Создано',
        priority: 'Приоритет',
      },
      direction: 'Направление',
      ascending: {
        queue: 'Сначала первые в очереди',
        updated: 'Сначала старые',
        created: 'Сначала старые',
        priority: 'Сначала низкий',
        other: 'По возрастанию',
      },
      descending: {
        queue: 'Сначала последние в очереди',
        updated: 'Сначала новые',
        created: 'Сначала новые',
        priority: 'Сначала высокий',
        other: 'По убыванию',
      },
      saved: 'Сохранённые виды',
      save: 'Сохранить вид…',
      delete: 'Удалить вид «{name}»',
      dropped:
        'Убран вид со значениями, которых эта версия не знает: {names} | Убраны виды со значениями, которых эта версия не знает: {names} | Убраны виды со значениями, которых эта версия не знает: {names}',
      droppedName: '«{name}»',
    },
    grouped: {
      noGoal: 'Без цели',
      space: 'Пространство {key} · {name}',
      severalProjects: 'Несколько проектов',
      noProject: 'Без проекта',
      stage: 'Этап {reference} · {title}',
    },
    saveView: {
      title: 'Сохранить вид',
      subtitle:
        'Представление, группировка, сортировка и фильтр, как сейчас, для этого пространства.',
      name: 'Название',
      replaces: 'Вид с таким названием будет заменён.',
      save: 'Сохранить',
      cancel: 'Отмена',
    },
  },
} as const
