import type { BridgeOpenRequest } from '@/shared/api/openPlanModel.ts'
import type { PlanningSpaceEntityRef } from '@/shared/types/reference.ts'

export interface SourceOpenResult {
  mode: 'opened' | 'copied'
  ok: boolean
  error?: string
  line?: number
  path?: string
}

interface SourceOpenRequest {
  resource_ref: PlanningSpaceEntityRef
  source: string
}

interface ValkamaDesktopBridge {
  /** Absent in a desktop app older than this page. */
  onOpenRoute?(listener: (route: string) => void): void
  /** Carry out one action of an open plan; the answer is read as `readBridgeAnswer` reads it. */
  openSession?(request: BridgeOpenRequest): Promise<unknown>
  openSource(request: SourceOpenRequest): Promise<SourceOpenResult>
}

declare global {
  interface Window {
    valkamaDesktop?: ValkamaDesktopBridge
  }
}

/**
 * Electron opens validated local references. A normal browser cannot receive
 * local-file authority, so it keeps the useful and honest copy fallback.
 */
export async function openSourceReference(request: SourceOpenRequest): Promise<SourceOpenResult> {
  if (window.valkamaDesktop) return window.valkamaDesktop.openSource(request)
  try {
    await navigator.clipboard.writeText(request.source)
    return { ok: true, mode: 'copied' }
  } catch (error) {
    return {
      ok: false,
      mode: 'copied',
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/** Successful Electron handoff is silent; copy fallback and failures need feedback. */
export function sourceFeedback(result: SourceOpenResult): 'copied' | 'failed' | null {
  if (!result.ok) return 'failed'
  return result.mode === 'copied' ? 'copied' : null
}
