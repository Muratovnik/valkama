/**
 * What a path written in free text can do from anywhere in the shell. A file or a
 * folder opens in the owner's editor by the server's plan, and the result is said
 * in the shell's status region; a refused plan answers why in the dictionary's words,
 * and the caller copies the path and says so. A Markdown document opens in the window's
 * viewer.
 */
import { useI18n } from 'vue-i18n'

import { openTarget } from '@/features/session-open/openPlan.ts'
import type { OpenTarget } from '@/features/session-open/openPlan.ts'
import { outcomeKind, outcomeWords, refusalWords } from '@/features/session-open/placeWords.ts'

import { provideDocumentOpener } from '@/entities/project-document/documentLinks.ts'
import type { DocumentTarget, OpenAnswer } from '@/entities/project-document/documentLinks.ts'

import type { SayNotice } from '@/shared/lib/notice.ts'
import { useSettingsStore } from '@/shared/stores/settingsStore.ts'

/** The name a notice calls a path by: its last segment, or for the project's root, the project. */
function shownName(project: string, path: string): string {
  const named = path.split(/[\\/]/u).filter((segment) => segment && segment !== '.')
  return named.at(-1) ?? project
}

type PathTarget = Extract<OpenTarget, { kind: 'file' | 'folder' }>

export function useDocumentOpening(
  say: SayNotice,
  openDocument: (target: DocumentTarget) => boolean,
): void {
  const { t } = useI18n()
  const settingsStore = useSettingsStore()

  async function open(target: PathTarget): Promise<OpenAnswer> {
    const outcome = await openTarget(target)
    if (outcome.status === 'refused') return refusalWords(t, outcome.refusal)
    const name = shownName(target.project, target.path)
    say(outcomeWords(t, outcome, { kind: target.kind, name }), outcomeKind(outcome))
    return true
  }

  provideDocumentOpener({
    say,
    openDocument,
    get editor() {
      return t(`open.place.${settingsStore.settings.editor}`)
    },
    openFile: ({ project, path, line }) => open({ kind: 'file', project, path, line }),
    openFolder: ({ project, path }) => open({ kind: 'folder', project, path }),
  })
}
