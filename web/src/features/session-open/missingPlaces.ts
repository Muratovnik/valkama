/**
 * A program this computer lacks is one reason for every session that would open in it:
 * on a card whose holder, agents and steps all open in a missing VS Code, «VS Code не
 * установлен» stood on each of them, twenty times, and ran into every name beside it.
 *
 * A surface that shows many sessions keeps one register of these programs. A button that
 * meets one puts it there and stands as a mark, the reason in its name; the surface says
 * the reason once (`MissingPlaces`). Outside a register a button says it in its own words,
 * as it says every reason that belongs to its session alone.
 */
import { computed, inject, onBeforeUnmount, provide, reactive, watch } from 'vue'
import type { ComputedRef, InjectionKey } from 'vue'

/** What each button that met a missing program reported, by the button. */
type Register = Map<symbol, string>

const REGISTER: InjectionKey<Register> = Symbol('missing-places')

/** The register for a surface's buttons; the surface says what it holds. */
export function provideMissingPlaces(): void {
  provide(REGISTER, reactive(new Map<symbol, string>()))
}

/** The programs the surface's buttons found missing, each once, in the order first met. */
export function useMissingPlaces(): ComputedRef<string[]> {
  const register = inject(REGISTER, null)
  return computed(() => [...new Set(register?.values())])
}

/**
 * Reports the program a button found missing, while it does, and says whether a register
 * takes it: the button then stands as a mark, and the surface says why.
 */
export function reportMissingPlace(missing: () => string): boolean {
  const register = inject(REGISTER, null)
  if (!register) return false
  const me = Symbol('open-action')
  watch(
    missing,
    (host) => {
      if (host) register.set(me, host)
      else register.delete(me)
    },
    { immediate: true },
  )
  onBeforeUnmount(() => register.delete(me))
  return true
}
