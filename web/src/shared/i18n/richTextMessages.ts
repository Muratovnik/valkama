/**
 * The words of free text: the markdown editor, and the links a text's
 * references become (`RichText`, `MarkdownEditor`, the reference layers).
 * A path's words have a file of their own and are carried here, because the
 * locale catalogues are held to the size they have.
 */
import { documentLinkMessages } from '@/shared/i18n/documentLinkMessages.ts'

export const richTextMessages = {
  en: {
    documentLinks: documentLinkMessages.en.documentLinks,
    editor: {
      write: 'Write',
      preview: 'Preview',
      view: 'Write or preview',
      hint: 'Markdown · Ctrl+Enter',
      tools: 'Formatting',
      tool: {
        mention: 'Mention a task or a file',
        bold: 'Bold',
        italic: 'Italic',
        code: 'Code',
        link: 'Link',
        list: 'Bulleted list',
      },
      empty: 'Nothing to preview yet.',
      suggestions: 'Mentions',
      kinds: { task: 'Tasks', file: 'Files' },
      found: 'Nothing found | One match found | {count} matches found',
      noSuggestions: 'Nothing matches “{query}”.',
      queryPrompt: "Type a task's number or a word from its title, or a file's name.",
    },
    textFrames: {
      table: 'Table: {columns}',
      tableBare: 'Table',
      code: 'Code block',
      codeIn: 'Code block: {language}',
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
        "Git did not find this commit in the task's project, the configured document roots or any other registered project.",
      memoryPointer:
        'This points at an AgentMemory record. Its text lives there; Valkama keeps only the pointer.',
    },
  },
  ru: {
    documentLinks: documentLinkMessages.ru.documentLinks,
    editor: {
      write: 'Текст',
      preview: 'Просмотр',
      view: 'Текст или просмотр',
      hint: 'Markdown · Ctrl+Enter',
      tools: 'Форматирование',
      tool: {
        mention: 'Упомянуть задачу или файл',
        bold: 'Жирный',
        italic: 'Курсив',
        code: 'Код',
        link: 'Ссылка',
        list: 'Маркированный список',
      },
      empty: 'Пока нечего показать.',
      suggestions: 'Упоминания',
      kinds: { task: 'Задачи', file: 'Файлы' },
      found: 'Найден {count} вариант | Найдено {count} варианта | Найдено {count} вариантов',
      noSuggestions: 'По «{query}» ничего не найдено.',
      queryPrompt: 'Введите номер или слово из названия задачи либо имя файла.',
    },
    textFrames: {
      table: 'Таблица: {columns}',
      tableBare: 'Таблица',
      code: 'Фрагмент кода',
      codeIn: 'Фрагмент кода: {language}',
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
        'Git не нашёл этот коммит ни в проекте задачи, ни в настроенных корнях документов, ни в других зарегистрированных проектах.',
      memoryPointer:
        'Это указатель на запись в AgentMemory. Её текст хранится там, Valkama хранит только ссылку.',
    },
  },
} as const
