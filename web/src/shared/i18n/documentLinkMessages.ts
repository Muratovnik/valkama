/**
 * The words of a path written in a text: what pressing it will do, why it only
 * copies, and what came of the press (`entities/project-document`).
 */
export const documentLinkMessages = {
  en: {
    documentLinks: {
      openDocument: 'Open the document in Valkama: {path}',
      openFile: 'Open in {editor}: {path}',
      openFileLine: 'Open in {editor}: {path}, line {line}',
      openFolder: 'Open the folder in {editor}: {path}',
      copied: 'Path copied',
      copyFailed: 'Could not copy. Select the path by hand',
      openFailed: 'Could not open it, so the path was copied',
      copy: {
        ambiguous: 'Copy the path {path}: it exists in several projects',
        checking: 'Copy the path {path}: Valkama is still checking it',
        missing: 'Copy the path {path}: nothing is there',
        network: 'Copy the path {path}: a network path, which Valkama does not open',
        noOpener: 'Copy the path {path}: Valkama cannot open it yet',
        outside: 'Copy the path {path}: it is outside the Valkama projects',
        refused: 'Copy the path {path}: Valkama does not open this path',
        spaceUnbound: 'Copy the path {path}: this space has no project root',
        unreachable: 'Copy the path {path}: the Valkama server did not answer',
      },
    },
  },
  ru: {
    documentLinks: {
      openDocument: 'Открыть документ в Valkama: {path}',
      openFile: 'Открыть в {editor}: {path}',
      openFileLine: 'Открыть в {editor}: {path}, строка {line}',
      openFolder: 'Открыть папку в {editor}: {path}',
      copied: 'Путь скопирован',
      copyFailed: 'Не удалось скопировать — выделите путь вручную',
      openFailed: 'Не удалось открыть — путь скопирован',
      copy: {
        ambiguous: 'Скопировать путь {path} — такой путь есть в нескольких проектах',
        checking: 'Скопировать путь {path} — Valkama ещё проверяет путь',
        missing: 'Скопировать путь {path} — такого пути нет',
        network: 'Скопировать путь {path} — сетевой путь, Valkama его не открывает',
        noOpener: 'Скопировать путь {path} — Valkama пока не умеет его открыть',
        outside: 'Скопировать путь {path} — он вне проектов Valkama',
        refused: 'Скопировать путь {path} — Valkama такой путь не открывает',
        spaceUnbound: 'Скопировать путь {path} — у пространства нет корня проекта',
        unreachable: 'Скопировать путь {path} — сервер Valkama не ответил',
      },
    },
  },
}
