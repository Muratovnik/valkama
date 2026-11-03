/**
 * The window's one document view, above every host that draws it, and the action that
 * opens a Markdown file in it. Whoever fills the shell's opener passes that action on.
 */
import { watch } from 'vue'
import type { WatchSource } from 'vue'

import { useDocumentView } from '@/widgets/document-viewer/composables/useDocumentView.ts'

import type { DocumentTarget } from '@/entities/project-document/documentLinks.ts'

/** `openedFrom` is what a document was opened from: it goes when that does. */
export function useAppDocuments(openedFrom: WatchSource[]) {
  const documentView = useDocumentView()
  const openDocument = ({ path, project, suffix }: DocumentTarget) => {
    documentView.open({ path, project, suffix })
    return true
  }
  watch(openedFrom, () => documentView.close())
  return { documentView, openDocument }
}
