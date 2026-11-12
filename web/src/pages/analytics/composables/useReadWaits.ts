/**
 * The Analytics page's read waits, said once. The page holds one status region (`WaitStatus`),
 * shown while at least one of its waits is shown (`useLoadingPresence`), so a cold entry that
 * reads a dozen figures is announced once, not once per tile. Each wait drawn inside the
 * page reports whether it is shown, for as long as it is drawn; a wait drawn outside the page
 * reports to nobody, and its own words still show.
 */
import { computed, inject, onScopeDispose, provide, shallowReactive } from 'vue'
import type { ComputedRef, InjectionKey } from 'vue'

const WAITS: InjectionKey<Set<ComputedRef<boolean>>> = Symbol('analytics-read-waits')

/** The page's own: the waits it is given, and whether any of them is shown. */
export function provideReadWaits() {
  const waits = shallowReactive(new Set<ComputedRef<boolean>>())
  provide(WAITS, waits)
  return { shown: computed(() => [...waits].some((wait) => wait.value)) }
}

/** A wait drawn in the page reports whether it is shown, until it is taken away. */
export function useReadWaitReport(shown: ComputedRef<boolean>) {
  const waits = inject(WAITS, null)
  if (!waits) return
  waits.add(shown)
  onScopeDispose(() => waits.delete(shown))
}
