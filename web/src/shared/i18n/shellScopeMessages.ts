/* The words of the shell's scope: the choice of a space and a project, and every space. */

export const shellScopeMessages = {
  en: {
    scope: {
      label: 'Space',
      global: 'All spaces',
      project: 'Project',
      allProjects: 'All projects',
      spaceMissing: 'Not found',
      otherSpace: 'A project of another space',
      retired: 'An address that names a project no longer opens: work is chosen by its space now.',
      choose: 'Choose a space',
    },
    planning: {
      noSpaces: 'No spaces yet.',
      noSpacesDetail: 'Run the Host Runtime project setup, bind a planning space, then refresh.',
      registryUnavailable:
        'The project list could not be read. Open Settings to check the installation.',
      spaceMissing: 'Space {space} was not found. Choose a space below.',
      otherSpace: 'This address names work outside the space it opens.',
      workItemCount: '{count} work items',
      projects: 'Projects',
      noProjects: 'No projects',
      openSpace: 'Open space',
      numbers: 'Where its work stands',
      numbersAbsent: {
        old_store: 'No data: an earlier build wrote this space’s store.',
        unreadable: 'The space could not be read.',
      },
    },
  },
  ru: {
    scope: {
      label: 'Пространство',
      global: 'Все пространства',
      project: 'Проект',
      allProjects: 'Все проекты',
      spaceMissing: 'Не найдено',
      otherSpace: 'Проект другого пространства',
      retired: 'Адрес с проектом больше не открывается: работу теперь выбирают по пространству.',
      choose: 'Выбрать пространство',
    },
    planning: {
      noSpaces: 'Пространств пока нет.',
      noSpacesDetail:
        'Запустите настройку проекта в Host Runtime, привяжите пространство и обновите экран.',
      registryUnavailable:
        'Список проектов не прочитан. Откройте «Настройки», чтобы проверить установку.',
      spaceMissing: 'Пространство {space} не найдено. Выберите пространство ниже.',
      otherSpace: 'Адрес называет работу вне пространства, которое открывает.',
      workItemCount: 'Задач: {count}',
      projects: 'Проекты',
      noProjects: 'Проектов нет',
      openSpace: 'Открыть пространство',
      numbers: 'Где стоит работа',
      numbersAbsent: {
        old_store: 'Нет данных: хранилище пространства записано прежней сборкой.',
        unreadable: 'Пространство не прочитано.',
      },
    },
  },
}
