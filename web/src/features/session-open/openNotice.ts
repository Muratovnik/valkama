/**
 * Where a session's button says what came of a press. The words belong in the shell's
 * status region, which lies above every overlay and which a feature cannot reach, so
 * the shell hands its own way of saying down to whichever button asks.
 */
import { inject, provide } from 'vue'
import type { InjectionKey } from 'vue'

import type { SayNotice } from '@/shared/lib/notice.ts'

const OPEN_NOTICE: InjectionKey<SayNotice> = Symbol('open-notice')

const SAY_NOTHING: SayNotice = () => {}

export function provideOpenNotice(say: SayNotice): void {
  provide(OPEN_NOTICE, say)
}

export function useOpenNotice(): SayNotice {
  return inject(OPEN_NOTICE, SAY_NOTHING)
}
