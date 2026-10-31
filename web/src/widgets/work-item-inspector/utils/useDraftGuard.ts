/**
 * Unsaved work in an open item, and the one place that asks before it is lost.
 *
 * Description edits and an unsent comment live in their own sections, several
 * components below the drawer that closes. Closing used to unmount them without
 * a word, so a paragraph typed and not yet saved was gone. Each section names its
 * draft here; the inspector asks this registry before any departure it owns.
 */
import { computed, inject, onBeforeUnmount, provide, reactive } from 'vue'
import type { InjectionKey } from 'vue'

export type DraftKind = 'comment' | 'description' | 'report'

interface DraftSource {
  kind: DraftKind
  dirty: () => boolean
}

interface DraftRegistry {
  register: (id: symbol, source: DraftSource) => void
  unregister: (id: symbol) => void
}

const DRAFTS: InjectionKey<DraftRegistry> = Symbol('inspector-drafts')

/** The provider side: which kinds of draft would be lost right now, in a stable order. */
export function provideDraftGuard() {
  const sources = reactive(new Map<symbol, DraftSource>())
  provide(DRAFTS, {
    register: (id, source) => sources.set(id, source),
    unregister: (id) => sources.delete(id),
  })
  const unsaved = computed(() =>
    (['description', 'comment', 'report'] as const).filter((kind) =>
      [...sources.values()].some((source) => source.kind === kind && source.dirty()),
    ),
  )
  return { unsaved }
}

/** A section's side: it says what its draft is and when it differs from what is saved. */
export function useDraftSource(kind: DraftKind, dirty: () => boolean) {
  const registry = inject(DRAFTS, null)
  if (registry === null) return
  const id = Symbol(kind)
  registry.register(id, { kind, dirty })
  onBeforeUnmount(() => registry.unregister(id))
}
