/**
 * The window's one document view, above every host that draws it, and the action that
 * opens a Markdown file in it. Whoever fills the shell's opener passes that action on.
 *
 * A document opened from a surface goes with that surface (`useDocumentPanes`). One opened
 * from nothing that answers for it goes on any move of the shell's, as nothing else would
 * take it away.
 */
import { watch } from 'vue'
import type { WatchSource } from 'vue'

import {
  createDocumentPanes,
  provideDocumentPanes,
} from '@/widgets/document-viewer/composables/useDocumentPanes.ts'
import { useDocumentView } from '@/widgets/document-viewer/composables/useDocumentView.ts'

import type { DocumentTarget } from '@/entities/project-document/documentLinks.ts'

/** `shellMoves` are what takes a document with no surface answering for it away. */
export function useAppDocuments(shellMoves: WatchSource[]) {
  const documentView = useDocumentView()
  const documentPanes = createDocumentPanes(documentView)
  provideDocumentPanes(documentPanes)
  const openDocument = ({ path, project, suffix }: DocumentTarget) => {
    documentPanes.open({ path, project, suffix })
    return true
  }
  watch(shellMoves, () => {
    if (!documentPanes.owned()) documentView.close()
  })
  return { documentView, openDocument }
}
