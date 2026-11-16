/*
 * What `doctor` says about the project registry, its folders and the store each planning
 * binding names -- by presentation code, in both languages.
 */

export const doctorProjectMessages = {
  en: {
    'registry-available': {
      title: 'Project registry',
      detail: '{count} projects are registered.',
    },
    'registry-unavailable': {
      title: 'Project registry is unavailable',
      detail: 'Valkama cannot read the project list.',
      fix: 'Check that the registry file exists and contains valid JSON.',
    },
    'project-roots-available': {
      title: 'Project folders',
      detail: 'Every mapped project folder exists.',
    },
    'project-roots-missing': {
      title: 'Project folders are missing',
      detail: 'Folders are missing for: {projects}.',
      fix: 'The project was moved or removed. Update canonical_root in the registry.',
    },
    'knowledge-roots-available': {
      title: 'Knowledge folders',
      detail: 'A {directory} folder is available for every project.',
    },
    'knowledge-roots-missing': {
      title: 'Knowledge folders are missing',
      detail: 'No {directory} folder was found in: {projects}.',
      fix: 'Create the folder for knowledge search, or leave it absent if the project keeps knowledge elsewhere.',
    },
    'planning-stores-available': {
      title: 'Planning store bindings',
      detail: 'Every planning binding names the main store or an attached store.',
    },
    'planning-stores-foreign': {
      title: 'A project is bound to a store that is not attached',
      detail:
        '{count} binding(s) name a store that is neither the main nor an attached store: {bindings}.',
      fix: 'Attach the database that holds the space, or bind the project to a space it holds.',
    },
    'planning-stores-unreadable': {
      title: 'An attached store cannot be read',
      detail:
        '{unreadable} store(s) cannot be read, so {count} binding(s) may name one of them: {bindings}.',
      fix: 'Restore the attached store that cannot be read, or bind the project to a space in an attached store.',
    },
  },
  ru: {
    'registry-available': {
      title: 'Реестр проектов',
      detail: 'Зарегистрировано проектов: {count}.',
    },
    'registry-unavailable': {
      title: 'Реестр проектов недоступен',
      detail: 'Valkama не может прочитать список проектов.',
      fix: 'Проверьте, что файл реестра существует и содержит корректный JSON.',
    },
    'project-roots-available': {
      title: 'Каталоги проектов',
      detail: 'Все привязанные каталоги существуют.',
    },
    'project-roots-missing': {
      title: 'Не найдены каталоги проектов',
      detail: 'Отсутствуют каталоги: {projects}.',
      fix: 'Проект был перемещён или удалён. Обновите canonical_root в реестре.',
    },
    'knowledge-roots-available': {
      title: 'Каталоги знаний',
      detail: 'Для каждого проекта доступен каталог {directory}.',
    },
    'knowledge-roots-missing': {
      title: 'Нет каталогов знаний',
      detail: 'Каталог {directory} не найден в: {projects}.',
      fix: 'Создайте каталог для поиска по знаниям или оставьте его отсутствующим, если проект хранит знания в другом месте.',
    },
    'planning-stores-available': {
      title: 'Привязки пространств к хранилищам',
      detail: 'Каждая привязка пространства называет основное хранилище или подключённое.',
    },
    'planning-stores-foreign': {
      title: 'Проект привязан к неподключённому хранилищу',
      detail: 'Привязки к хранилищу, которое не основное и не подключено ({count}): {bindings}.',
      fix: 'Подключите хранилище, в котором лежит пространство, или привяжите проект к пространству основного или подключённого хранилища.',
    },
    'planning-stores-unreadable': {
      title: 'Хранилище не читается',
      detail:
        'Хранилищ, которые не читаются: {unreadable}. Привязки, которые могут указывать на них ({count}): {bindings}.',
      fix: 'Восстановите хранилище, которое не читается, или привяжите проект к пространству хранилища, которое читается.',
    },
  },
}
