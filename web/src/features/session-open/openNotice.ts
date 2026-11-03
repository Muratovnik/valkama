/**
 * Where a session's button says what came of a press. The words belong in the shell's
 * status region, which lies above every overlay and which a feature cannot reach, so
 * the shell hands its own way of saying down to whichever button asks.
 */
import { inject, provide } from 'vue'
import type { InjectionKey } from 'vue'

type Say = (message: string) => void

const OPEN_NOTICE: InjectionKey<Say> = Symbol('open-notice')

const SAY_NOTHING: Say = () => {}

export function provideOpenNotice(say: Say): void {
  provide(OPEN_NOTICE, say)
}

export function useOpenNotice(): Say {
  return inject(OPEN_NOTICE, SAY_NOTHING)
}
