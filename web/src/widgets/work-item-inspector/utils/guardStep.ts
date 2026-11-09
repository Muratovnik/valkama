import type { Ref } from 'vue'

import type { InspectorSection } from '@/widgets/work-item-inspector/utils/useInspectorSections.ts'
import type { StateMove } from '@/widgets/work-item-inspector/utils/useInspectorWrites.ts'

interface GuardCard {
  overview: {
    askOutcome: (move: StateMove) => unknown
    revealChecklist: () => unknown
  } | null
  section: Ref<InspectorSection>
  /** The move that was refused, which a summary carries on. */
  move?: StateMove
  claim: () => void
  /** Takes the refusal's notice away once its step is under way. */
  dismiss: () => void
}

/**
 * The next step a refused move's guard asks for, taken where the card can take it: a claim
 * for a missing executor, Relations for an open blocker, and on Overview the outcome a summary
 * asks for or the checklist whose steps are still open.
 */
export function followGuard(guard: string, card: GuardCard) {
  if (guard === 'executor') {
    card.claim()
    return
  }
  card.dismiss()
  card.section.value = guard === 'blocker' ? 'relations' : 'overview'
  if (guard === 'summary' && card.move) void card.overview?.askOutcome(card.move)
  else if (guard === 'checklist') void card.overview?.revealChecklist()
}
