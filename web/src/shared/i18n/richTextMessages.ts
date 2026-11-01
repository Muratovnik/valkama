/**
 * The words of free text: the markdown editor, and the links a text's
 * references become (`RichText`, `MarkdownEditor`, the reference layers).
 */
export const richTextMessages = {
  en: {
    editor: {
      kind: 'What to publish',
      write: 'Write',
      preview: 'Preview',
      view: 'Write or preview',
      hint: 'Markdown · Ctrl+Enter: {action}',
      hintSuggest: 'Markdown · # and a number or a word links a task · Ctrl+Enter: {action}',
      empty: 'Nothing to preview yet.',
      suggestions: 'Tasks',
      found: 'No tasks found | One task found | {count} tasks found',
      noSuggestions: 'No tasks match “{query}”.',
    },
    textLinks: {
      openItem: 'Open task {reference}',
      openSession: 'Open session',
      showCommit: 'Show commit',
      showMemory: 'Show memory pointer',
      notFound: 'Task {reference} was not found.',
      loading: 'Looking up the commit…',
      failed: 'Git could not be asked. Try again later.',
      commitMissing:
        "Git did not find this commit in the repository of the task's project or in the configured document roots.",
      memoryPointer:
        'This points at an AgentMemory record. Its text lives there; Valkama keeps only the pointer.',
    },
  },
  ru: {
    editor: {
      kind: 'Что публикуется',
      write: 'Текст',
      preview: 'Просмотр',
      view: 'Текст или просмотр',
      hint: 'Markdown · Ctrl+Enter — {action}',
      hintSuggest: 'Markdown · # и номер или слово — ссылка на задачу · Ctrl+Enter — {action}',
      empty: 'Пока нечего показать.',
      suggestions: 'Задачи',
      found: 'Найдена {count} задача | Найдено {count} задачи | Найдено {count} задач',
      noSuggestions: 'Задач по «{query}» нет.',
    },
    textLinks: {
      openItem: 'Открыть задачу {reference}',
      openSession: 'Открыть сессию',
      showCommit: 'Показать коммит',
      showMemory: 'Показать ссылку на память',
      notFound: 'Задача {reference} не найдена.',
      loading: 'Ищу коммит…',
      failed: 'Не удалось спросить git. Попробуйте ещё раз позже.',
      commitMissing:
        'Git не нашёл этот коммит ни в репозитории проекта задачи, ни в настроенных корнях документов.',
      memoryPointer:
        'Это указатель на запись в AgentMemory. Её текст хранится там, Valkama хранит только ссылку.',
    },
  },
} as const
