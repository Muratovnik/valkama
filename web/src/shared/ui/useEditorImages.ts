import { inject, onBeforeUnmount, provide, ref } from 'vue'
import type { InjectionKey } from 'vue'
import { useI18n } from 'vue-i18n'

import { ImageRefusal } from '@/shared/api/imageApi.ts'
import {
  IMAGE_LIMIT,
  imageKind,
  imageMarkdown,
  SIGNATURE_BYTES,
} from '@/shared/lib/pastedImages.ts'

/**
 * Keeps one picture for the text being written and answers the address the text names it by.
 * What it refuses is the server's: an `ImageRefusal` for a picture too large or no picture
 * is said in the words the editor uses for those, and anything else as a failure to attach.
 */
export type ImageAttach = (file: File, signal: AbortSignal) => Promise<{ path: string }>

const ATTACH: InjectionKey<ImageAttach> = Symbol('editor-images')

/**
 * Let every editor below this component take a pasted or dropped picture, kept by `attach`.
 * Where a picture belongs is the host's to know — an item's card says which item — so an
 * editor with no host that provides this pastes as a text box always has.
 */
export function provideEditorImages(attach: ImageAttach): void {
  provide(ATTACH, attach)
}

/** Whether the clipboard also carries words, which a paste then writes as it always did. */
function carriesText(transfer: DataTransfer): boolean {
  return transfer.types.includes('text/plain') && transfer.getData('text/plain').trim() !== ''
}

/**
 * A picture pasted or dropped into an editor: refused at once when it is no picture or is
 * larger than the server keeps, otherwise sent, and its Markdown written at the caret once
 * the server has it. Hooked into the editor through three events on what holds its text,
 * and `insert`, which writes as typing would.
 *
 * A clipboard that carries words as well as a picture — a spreadsheet copies its cells as
 * both — is pasted as words: the picture of a table is not what someone pasting it meant.
 * A file is a picture by its first bytes, never by its name or the type it declares.
 */
export function useEditorImages(options: { insert: (text: string) => void }) {
  const attach = inject(ATTACH, null)
  const { t } = useI18n()
  /** Why the last picture was not attached; empty once there is nothing to say. */
  const refusal = ref('')
  /** What is under way, for a reader who cannot see the text change. */
  const status = ref('')
  let request: AbortController | null = null

  async function refused(file: File): Promise<string> {
    if (file.size > IMAGE_LIMIT) return t('pastedImages.tooLarge')
    const head = new Uint8Array(await file.slice(0, SIGNATURE_BYTES).arrayBuffer())
    return imageKind(head) ? '' : t('pastedImages.notImage')
  }

  /** The server's refusal in the editor's words, where it said which one it was. */
  function said(error: unknown): string {
    if (error instanceof ImageRefusal && error.status === 413) return t('pastedImages.tooLarge')
    if (error instanceof ImageRefusal && error.status === 415) return t('pastedImages.notImage')
    return t('pastedImages.failed')
  }

  async function send(files: readonly File[], keep: ImageAttach) {
    refusal.value = ''
    for (const file of files) {
      const reason = await refused(file)
      if (reason) {
        refusal.value = reason
        return
      }
    }
    request?.abort()
    const controller = new AbortController()
    request = controller
    status.value = t('pastedImages.sending')
    try {
      for (const file of files) {
        const kept = await keep(file, controller.signal)
        if (controller.signal.aborted) return
        options.insert(imageMarkdown(file.name || t('pastedImages.unnamed'), kept.path))
      }
      status.value = t('pastedImages.attached')
    } catch (error) {
      if (controller.signal.aborted) return
      status.value = ''
      refusal.value = said(error)
    } finally {
      if (request === controller) request = null
    }
  }

  /** Take the files a paste or a drop carries, leaving every other one to the text box. */
  function take(event: ClipboardEvent | DragEvent, transfer: DataTransfer | null) {
    if (!attach || !transfer || transfer.files.length === 0) return
    if (event.type === 'paste' && carriesText(transfer)) return
    event.preventDefault()
    void send([...transfer.files], attach)
  }

  onBeforeUnmount(() => request?.abort())

  return {
    refusal,
    status,
    /** A new word written clears what was said about the last picture. */
    clear() {
      refusal.value = ''
    },
    paste: (event: ClipboardEvent) => take(event, event.clipboardData),
    drop: (event: DragEvent) => take(event, event.dataTransfer),
    /** A drop lands only where a drag over it was allowed. */
    dragover(event: DragEvent) {
      if (attach && event.dataTransfer?.types.includes('Files')) event.preventDefault()
    },
  }
}
