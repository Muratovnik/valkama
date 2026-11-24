/**
 * How the page's reads stand beside what they show, for the parts that say it.
 *
 * Two facts, each the read's own: whether a new view — another period or filter — is read while
 * the last view's answer stays drawn (`anew`), and whether the last read again of the view on show
 * failed, its answer kept on show (`failed`), a part's own read that keeps what it showed among
 * them (`usePanelPartFailed`). The panel's read (`useUsageRead`), the rail's
 * (`useRailReads`) and the quota's (`useQuota`) each provide theirs. The panel and the tiles draw
 * the last view's answer dimmed while the new one is read (`useAnewDimmed`), the bar says beside
 * the data's age that a read again failed, the quota's as every other, and a part drawn with no
 * page around it stands settled.
 *
 * A read again of the same view dims nothing: it is no change the reader asked for, and «Now»
 * reads itself again every interval, so a dim then would blink the page on its own.
 */
import { computed, inject, onScopeDispose, provide, shallowRef } from 'vue'
import type { InjectionKey, Ref } from 'vue'

import { useLoadingPresence } from '@/shared/ui/loadingPresence.ts'

export interface ReadStanding {
  /** Whether a new view is read while the last view's answer stays on show. */
  anew: Readonly<Ref<boolean>>
  /** Whether the last read again of the view on show failed, its answer kept on show. */
  failed: Readonly<Ref<boolean>>
}

const SETTLED: ReadStanding = { anew: shallowRef(false), failed: shallowRef(false) }

const PANEL: InjectionKey<ReadStanding> = Symbol('analytics-panel-standing')
const RAIL: InjectionKey<ReadStanding> = Symbol('analytics-rail-standing')
const QUOTA: InjectionKey<ReadStanding> = Symbol('analytics-quota-standing')

export const providePanelStanding = (standing: ReadStanding) => provide(PANEL, standing)
export const provideRailStanding = (standing: ReadStanding) => provide(RAIL, standing)
export const provideQuotaStanding = (standing: ReadStanding) => provide(QUOTA, standing)

/** Whether a part's own read failed, what it showed kept on show. */
type PartFailed = () => boolean
const PANEL_PARTS: InjectionKey<(failed: PartFailed) => void> = Symbol('analytics-panel-parts')

/**
 * The parts drawn from the panel's answer that read apart from it and keep what they showed when
 * a read again fails — a split's pairs (`useCrossRead`), in the section and in the side panel of
 * all its values: whether any of them failed, for the panel's read to say with its own. Held room
 * for their words beside a table's download took a line of its own on a phone with nothing failed.
 */
export function providePanelParts() {
  const parts = shallowRef<readonly PartFailed[]>([])
  provide(PANEL_PARTS, (failed) => {
    parts.value = [...parts.value, failed]
    onScopeDispose(() => {
      parts.value = parts.value.filter((one) => one !== failed)
    })
  })
  return computed(() => parts.value.some((failed) => failed()))
}

/** A part's own read, its failure said with the panel's for as long as the part stands. */
export const usePanelPartFailed = (failed: PartFailed) => inject(PANEL_PARTS, null)?.(failed)

/** The panel's read alone, for the panel that draws its answer. */
export const usePanelStanding = () => inject(PANEL, SETTLED)

/**
 * The page's reads together, for what speaks for all of them — the bar — and for the tiles, which
 * draw the panel's answer (the overview's tile) and the rail's.
 */
export function usePageStanding(): ReadStanding {
  const panel = usePanelStanding()
  const rail = inject(RAIL, SETTLED)
  const quota = inject(QUOTA, SETTLED)
  return {
    anew: computed(() => panel.anew.value || rail.anew.value),
    failed: computed(() => panel.failed.value || rail.failed.value || quota.failed.value),
  }
}

/**
 * Whether a part drawn from the last view's answer is dimmed now: while `waiting` and a new view
 * is read, as the product shows every wait (`useLoadingPresence`) — not for a read quicker than a
 * wait takes to be shown, and once shown, long enough not to flash.
 */
export function useAnewDimmed(
  standing: Pick<ReadStanding, 'anew'>,
  waiting: () => boolean = () => true,
) {
  return useLoadingPresence(() => standing.anew.value && waiting()).shown
}
