/**
 * Where the window's one document stands: beside the surface it was opened from when the
 * window has room for both, over it when not. The view holds what the document is and
 * where the reader is in it, so this only ever picks a host.
 *
 * A document belongs to the surface it was opened from. That surface says how it stands
 * through `paneFit`, a change of its width or the window's can move the document between
 * hosts, and the document goes when the surface goes. A surface that goes on showing other
 * content is still the same surface, so going from a card to a card keeps what is being read
 * beside them, as a side view does. One opened from nothing that takes a pane stands over
 * it and goes when the shell says so.
 */
import {
  computed,
  inject,
  markRaw,
  onBeforeUnmount,
  provide,
  reactive,
  shallowRef,
  watch,
} from 'vue'
import type { InjectionKey } from 'vue'
import { useI18n } from 'vue-i18n'

import type {
  DocumentPlace,
  DocumentView,
} from '@/widgets/document-viewer/composables/useDocumentView.ts'

import type { OverlayPaneNames, PaneFit } from '@/shared/ui/overlayPanes.ts'

/** Those that can hold a document beside them, the one that lies over the other first. */
const SURFACES = ['hub', 'card'] as const
export type DocumentSurface = (typeof SURFACES)[number]

export function createDocumentPanes(view: DocumentView) {
  const standing = reactive<Partial<Record<DocumentSurface, PaneFit>>>({})
  const owner = shallowRef<DocumentSurface | null>(null)

  const where = computed<DocumentSurface | 'over' | null>(() => {
    if (!view.place.value) return null
    return owner.value && standing[owner.value]?.fits ? owner.value : 'over'
  })
  // Before the page changes: the host being left is the one that can say where the reader is.
  watch(where, (next, previous) => {
    if (next && previous) view.handOver()
  })

  function open(target: DocumentPlace) {
    owner.value = SURFACES.find((surface) => standing[surface]?.active) ?? null
    view.open(target)
  }

  function stand(surface: DocumentSurface, fit: PaneFit | null) {
    if (fit) {
      standing[surface] = fit
      return
    }
    Reflect.deleteProperty(standing, surface)
    if (owner.value !== surface) return
    owner.value = null
    view.close()
  }

  return {
    open,
    stand,
    view,
    where,
    /** Whether a surface answers for how long the document stands. */
    owned: () => owner.value !== null,
  }
}

type DocumentPanes = ReturnType<typeof createDocumentPanes>

const PANES: InjectionKey<DocumentPanes> = Symbol('document-panes')

export function provideDocumentPanes(panes: DocumentPanes): void {
  provide(PANES, panes)
}

/** Whether the document stands in the drawer: with no shell above it, always, while open. */
export function useDocumentOver(view: DocumentView) {
  const panes = inject(PANES, null)
  return computed(() => (panes ? panes.where.value === 'over' : view.place.value !== null))
}

/**
 * What a surface below the shell needs to hold the document: for its pane slot, and what it
 * hears from it. Without a shell above it there is no document to hold.
 */
export function useDocumentPane(surface: DocumentSurface, main: () => string) {
  const panes = inject(PANES, null)
  onBeforeUnmount(() => panes?.stand(surface, null))
  const { t } = useI18n()
  const pane = computed<OverlayPaneNames | null>(() =>
    panes?.where.value === surface
      ? {
          label: t('documentLinks.viewer.label', { title: panes.view.title.value }),
          main: main(),
          resize: t('documentLinks.viewer.resize'),
        }
      : null,
  )
  return reactive({
    pane,
    view: panes ? markRaw(panes.view) : null,
    close: () => panes?.view.close(),
    stand: (fit: PaneFit | null) => panes?.stand(surface, fit),
  })
}
