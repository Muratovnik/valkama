/**
 * What a path written in free text can do from anywhere in the shell. A file or a
 * folder opens in the owner's editor by the server's plan, and the result is said
 * in the shell's status region; a refused plan leaves the path copied, as the
 * links say. A Markdown document opens in the window's viewer.
 */
import { useI18n } from 'vue-i18n'

import { openTarget } from '@/features/session-open/openPlan.ts'
import type { OpenTarget } from '@/features/session-open/openPlan.ts'
import { outcomeWords } from '@/features/session-open/placeWords.ts'

import { provideDocumentOpener } from '@/entities/project-document/documentLinks.ts'
import type { DocumentTarget } from '@/entities/project-document/documentLinks.ts'

import { useSettingsStore } from '@/shared/stores/settingsStore.ts'

export function useDocumentOpening(
  say: (message: string) => void,
  openDocument: (target: DocumentTarget) => boolean,
): void {
  const { t } = useI18n()
  const settingsStore = useSettingsStore()

  async function open(target: OpenTarget): Promise<boolean> {
    const outcome = await openTarget(target)
    if (outcome.status === 'refused') return false
    say(outcomeWords(t, outcome))
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
