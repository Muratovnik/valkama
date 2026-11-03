/**
 * What a path written in free text can do from anywhere in this window.
 *
 * A Markdown file opens in the window's one viewer, whose state stands here, above
 * every host that draws it. Until the editor's plan lands, any other confirmed path
 * copies, as an unconfirmed one does.
 */
import { watch } from 'vue'
import type { WatchSource } from 'vue'

import { useDocumentView } from '@/widgets/document-viewer/composables/useDocumentView.ts'

import { provideDocumentOpener } from '@/entities/project-document/documentLinks.ts'

export function useAppDocuments({
  openedFrom,
  say,
}: {
  /** What a document was opened from: it goes when that does. */
  openedFrom: WatchSource[]
  say: (message: string) => void
}) {
  const view = useDocumentView()
  provideDocumentOpener({
    say,
    openDocument: ({ path, project, suffix }) => {
      view.open({ path, project, suffix })
      return true
    },
  })
  watch(openedFrom, () => view.close())
  return view
}
