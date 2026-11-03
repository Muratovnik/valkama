/**
 * What a click would do, read before any click so a button can say so. Nothing here
 * carries a plan out.
 */

import { appCall, currentSettings, placesFor, queryFor } from '@/features/session-open/openPlan.ts'
import type { OpenChoices, OpenTarget } from '@/features/session-open/openPlan.ts'

import { fetchOpenPlan } from '@/shared/api/openPlanModel.ts'
import type { OpenPlan, Surface } from '@/shared/api/openPlanModel.ts'
import type { PlatformSettings } from '@/shared/lib/settings.ts'

/** The reads under way, so the buttons of one session on a card ask once between them. */
const previews = new Map<string, Promise<OpenPlan | null>>()

async function readPreview(
  target: OpenTarget,
  settings: PlatformSettings,
  on: Surface,
): Promise<OpenPlan | null> {
  try {
    const chosen = await placesFor(target, settings, on)
    return 'custom' in chosen
      ? null
      : (chosen.plan ?? (await fetchOpenPlan(queryFor(target, on, chosen.places))))
  } catch {
    // Not knowing is no refusal: what the card's read said stands until a click plans.
    return null
  }
}

/**
 * What a click would do, read before any click so a button can say so. It carries
 * nothing out and runs nothing, and a click plans again for itself: in the app, a plan
 * the page holds may have gone stale by then. No answer is `null`, also for a family
 * whose own command takes no plan.
 */
export function previewOpen(
  target: OpenTarget,
  choices: OpenChoices = {},
): Promise<OpenPlan | null> {
  const settings = currentSettings(choices)
  const on: Surface = appCall() ? 'desktop' : 'browser'
  const key = JSON.stringify([target, on, settings.sessions])
  const asked = previews.get(key)
  if (asked) return asked
  const asking = readPreview(target, settings, on).finally(() => previews.delete(key))
  previews.set(key, asking)
  return asking
}
