/**
 * The Work views' menu beside «Kanban / List / Graph»: how the view is grouped,
 * the views saved in the space, the note on views this version could not read, and
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
      saved: 'Saved views',
      save: 'Save view…',
      delete: 'Delete view “{name}”',
      dropped:
        'Removed a view with values this version does not know: {names} | Removed views with values this version does not know: {names}',
      droppedName: '“{name}”',
    },
    saveView: {
      title: 'Save view',
      subtitle: 'The view, the grouping and the filter, as they are now, for this space.',
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
      saved: 'Сохранённые виды',
      save: 'Сохранить вид…',
      delete: 'Удалить вид «{name}»',
      dropped:
        'Убран вид со значениями, которых эта версия не знает: {names} | Убраны виды со значениями, которых эта версия не знает: {names} | Убраны виды со значениями, которых эта версия не знает: {names}',
      droppedName: '«{name}»',
    },
    saveView: {
      title: 'Сохранить вид',
      subtitle: 'Представление, группировка и фильтр, как сейчас, для этого пространства.',
      name: 'Название',
      replaces: 'Вид с таким названием будет заменён.',
      save: 'Сохранить',
      cancel: 'Отмена',
    },
  },
} as const
