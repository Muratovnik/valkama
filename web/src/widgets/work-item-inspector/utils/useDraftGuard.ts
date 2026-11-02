/**
 * Unsaved work in an open item, and the one place that asks before it is lost.
 *
 * Description edits and an unsent comment live in their own sections, several
 * components below the drawer that closes. Closing used to unmount them without
 * a word, so a paragraph typed and not yet saved was gone. Each section names its
 * draft here, and every way out of the item asks this registry first:
 *
 * - the departures the inspector owns — close, Escape, the back step, a related
 *   item — through `leave`;
 * - every other one — browser Back and Forward, global search, any route the shell writes — through
 *   the router's leave check, which asks the same question in the same place;
 * - reload and closing the tab through `beforeunload`, the one departure a page
 *   cannot word, registered only while there is a draft to lose.
 */
import { computed, inject, onBeforeUnmount, provide, reactive, ref, watch } from 'vue'
import type { InjectionKey } from 'vue'

import { registerLeaveCheck } from '@/shared/lib/leaveGuard.ts'

export type DraftKind = 'comment' | 'description' | 'outcome'

interface DraftSource {
  kind: DraftKind
  dirty: () => boolean
}

interface DraftRegistry {
  register: (id: symbol, source: DraftSource) => void
  unregister: (id: symbol) => void
}

const DRAFTS: InjectionKey<DraftRegistry> = Symbol('inspector-drafts')

/** The browser's own prompt; the text it shows is the browser's, not ours. */
function holdUnload(event: BeforeUnloadEvent) {
  event.preventDefault()
  // Chromium before 119 asks only when this is set.
  event.returnValue = ''
}

/**
 * The provider side: which drafts would be lost right now, in a stable order,
 * and the question asked before they are.
 */
export function provideDraftGuard() {
  const sources = reactive(new Map<symbol, DraftSource>())
  provide(DRAFTS, {
    register: (id, source) => sources.set(id, source),
    unregister: (id) => sources.delete(id),
  })
  const unsaved = computed(() =>
    (['description', 'comment', 'outcome'] as const).filter((kind) =>
      [...sources.values()].some((source) => source.kind === kind && source.dirty()),
    ),
  )

  /** True while the question stands under the bar. */
  const asking = ref(false)
  let answer: ((discard: boolean) => void) | null = null

  /**
   * Ask once; a second departure while the first is asked replaces it, and the
   * first is answered "keep", so a navigation waiting on it is refused.
   */
  function ask(): Promise<boolean> {
    answer?.(false)
    asking.value = true
    return new Promise((resolve) => {
      answer = (discard) => {
        answer = null
        asking.value = false
        resolve(discard)
      }
    })
  }

  const keep = () => answer?.(false)
  const discard = () => answer?.(true)

  /**
   * A discard the operator already answered, for the navigation it starts. The
   * inspector's own departures become a route change, and the router must not
   * ask about drafts the operator has just chosen to drop. It lasts until that
   * navigation has consulted it, and no longer than the current task.
   */
  let released = false

  /** Leave by the inspector's own hand, asking first when that drops a draft. */
  async function leave(action: () => void) {
    if (unsaved.value.length) {
      if (!(await ask())) return
      released = true
      setTimeout(() => {
        released = false
      })
    }
    action()
  }

  const unregister = registerLeaveCheck(() => {
    if (released) {
      released = false
      return true
    }
    return unsaved.value.length ? ask() : true
  })

  const dirty = computed(() => unsaved.value.length > 0)
  watch(
    dirty,
    (holding) => {
      if (holding) window.addEventListener('beforeunload', holdUnload)
      else window.removeEventListener('beforeunload', holdUnload)
    },
    { immediate: true },
  )

  onBeforeUnmount(() => {
    unregister()
    keep()
    window.removeEventListener('beforeunload', holdUnload)
  })

  return { asking, discard, keep, leave, unsaved }
}

/** A section's side: it says what its draft is and when it differs from what is saved. */
export function useDraftSource(kind: DraftKind, dirty: () => boolean) {
  const registry = inject(DRAFTS, null)
  if (registry === null) return
  const id = Symbol(kind)
  registry.register(id, { kind, dirty })
  onBeforeUnmount(() => registry.unregister(id))
}
