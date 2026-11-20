/**
 * The read of the Volumes page: one answer of `GET /api/planning/volumes` for the page's scope,
 * period and filter, held as one state the page's shared panel draws (`PlatformStatePanel`).
 *
 * Once something is drawn, a read again of the same view replaces it when its answer lands, so
 * nothing blinks; a read of another view keeps the last one drawn and dimmed (`pending`) until its
 * answer lands, so the last view is never shown as the current one. A read again that fails keeps
 * what is drawn and says it could not refresh; a first read that fails is the shared error panel
 * with its retry. A newer read stops an older one still under way.
 *
 * A scope with no work in it — no number above zero, no goal and nothing outside goals — is the
 * panel's empty state: «There is no work in this scope».
 */
import { computed, ref, shallowRef, watch } from 'vue'

import { uiDegraded, uiEmpty, uiError, uiLoading, uiReady } from '@/shared/api/platformUiState.ts'
import type { PlatformUiState } from '@/shared/api/platformUiState.ts'
import { readVolumes } from '@/shared/api/volumesReadApi.ts'
import type { Volumes, VolumesQuery } from '@/shared/api/volumesReadApi.ts'

/** Whether a read holds any work: a number, a goal or a task outside goals. */
function holdsWork(volumes: Volumes): boolean {
  const { categories, waiting_owner } = volumes.counts
  return (
    categories.some((row) => row.tasks + (row.goals ?? 0) + (row.stages ?? 0) > 0) ||
    waiting_owner.count > 0 ||
    Boolean(volumes.counts.unattached_commits) ||
    volumes.goals.length > 0 ||
    volumes.outside.tasks > 0
  )
}

export function useVolumesRead(options: {
  /** What the read asks; null for a period that cannot be read yet. */
  query: () => VolumesQuery | null
  /** The view the read is of, its scope with it: a read again keeps it, another view does not. */
  view: () => unknown
}) {
  const state = shallowRef<PlatformUiState<Volumes>>(uiLoading())
  /** The last view is drawn, dimmed, while another view's answer is on its way. */
  const pending = ref(false)
  let controller: AbortController | null = null

  const drawn = () => {
    const now = state.value
    return now.status === 'ready' || now.status === 'degraded' ? now.payload : null
  }

  async function read() {
    controller?.abort()
    const asked = new AbortController()
    controller = asked
    const wanted = options.query()
    if (wanted === null) {
      pending.value = false
      state.value = uiEmpty('volumes.incomplete')
      return
    }
    if (drawn() === null) state.value = uiLoading()
    try {
      const volumes = await readVolumes(wanted, asked.signal)
      if (asked.signal.aborted) return
      pending.value = false
      state.value = holdsWork(volumes) ? uiReady(volumes) : uiEmpty('volumes.empty')
    } catch {
      if (asked.signal.aborted) return
      pending.value = false
      const kept = drawn()
      state.value = kept
        ? uiDegraded(kept, new Date().toISOString(), 'volumes.refreshFailed')
        : uiError('volumes.failed')
    }
  }

  /** Another view: the last one stays drawn and dimmed until this one's answer lands. */
  function readAnother() {
    pending.value = drawn() !== null
    void read()
  }

  watch(() => JSON.stringify(options.view()), readAnother, { immediate: true })

  return {
    pending: computed(() => pending.value),
    /** Read the view on show again. */
    refresh: read,
    state: computed(() => state.value),
  }
}
