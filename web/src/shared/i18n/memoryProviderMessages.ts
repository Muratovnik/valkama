export const memoryProviderMessages = {
  en: {
    heading: 'Knowledge by project',
    intro:
      'Where each project keeps what it knows. The root is read from the registry, not chosen here.',
    none: 'No project is registered',
    noneDetail: 'Register a project before it can point at anything.',
    open: 'Open',
    reason: {
      project_unmapped: 'This project has no mapped root.',
      knowledge_root_absent: 'The project has no docs directory.',
      project_unregistered: 'This project is no longer registered.',
    },
  },
  ru: {
    heading: 'Знание по проектам',
    intro:
      'Где каждый проект держит то, что знает. Корень берётся из реестра, а не выбирается здесь.',
    none: 'Ни один проект не зарегистрирован',
    noneDetail: 'Пока проект не зарегистрирован, указывать ему не на что.',
    open: 'Открыть',
    reason: {
      project_unmapped: 'У проекта нет связанного корневого каталога.',
      knowledge_root_absent: 'В проекте нет каталога docs.',
      project_unregistered: 'Проект больше не зарегистрирован.',
    },
  },
} as const
