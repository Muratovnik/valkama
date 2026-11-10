/**
 * What a press that opens a session does, whatever is pressed: the session button
 * (`OpenAction`) or a row that stands for a session. It plans at the press: one action
 * runs at once, and a plan that takes more or leads with an explanation is handed to
 * `OpenPanel`, as is an app that answers with a next step. What came of it is said in the
 * shell's status region. While it works it is busy, and a second press is not taken.
 */
import { ref, shallowRef } from 'vue'
import type { Ref, ShallowRef } from 'vue'
import { useI18n } from 'vue-i18n'

import { useOpenNotice } from '@/features/session-open/openNotice.ts'
import { prepareOpen } from '@/features/session-open/openPlan.ts'
import type { OpenAction, OpenTarget, Outcome, Refusal } from '@/features/session-open/openPlan.ts'
import { heardOfSession } from '@/features/session-open/openPreview.ts'
import { outcomeKind, outcomeWords } from '@/features/session-open/placeWords.ts'

import type { PlanOpens } from '@/shared/api/openPlanModel.ts'

/** What `OpenPanel` is opened with. */
interface OpenPanelState {
  actions: readonly OpenAction[]
  notice: Refusal | null
  offer: OpenAction | null
  opens: PlanOpens | null
}

export interface OpenPress {
  busy: Ref<boolean>
  /** The panel to show, while one is open. */
  panel: ShallowRef<OpenPanelState | null>
  /** The panel carried an action out, or the person closed it after one. */
  finished: (outcome: Outcome) => void
  press: () => Promise<void>
}

/**
 * A press on a session: `target` is read at the press, and `name` is who the status
 * region says it opened, as the surface prints that session.
 */
export function useOpenPress(target: () => OpenTarget, name: () => string): OpenPress {
  const { t } = useI18n()
  const say = useOpenNotice()
  const busy = ref(false)
  const panel = shallowRef<OpenPanelState | null>(null)

  function report(outcome: Outcome) {
    say(outcomeWords(t, outcome, { kind: 'session', name: name() }), outcomeKind(outcome))
    const opened = target()
    if (outcome.status === 'refused' && opened.kind === 'session') heardOfSession(opened.session)
  }

  /** What came of a single action: done, or a panel where it says more can be done. */
  function answeredByTheFirst(outcome: Outcome) {
    const offer = 'offer' in outcome ? (outcome.offer ?? null) : null
    if (outcome.status === 'next')
      panel.value = {
        actions: [outcome.next],
        notice: outcome.notice,
        offer,
        opens: outcome.opens,
      }
    else if (outcome.status === 'refused' && offer)
      panel.value = { actions: [], notice: outcome.refusal, offer, opens: outcome.opens ?? null }
    else report(outcome)
  }

  async function press() {
    if (busy.value) return
    busy.value = true
    try {
      const { actions, notice, offer, plan } = await prepareOpen(target())
      const [first] = actions
      if (actions.length > 1 || (first && notice) || offer)
        panel.value = { actions, notice, offer, opens: plan?.opens ?? null }
      else if (first) answeredByTheFirst(await first.run())
      else report({ status: 'refused', refusal: notice ?? { reason: 'no-session' } })
    } finally {
      busy.value = false
    }
  }

  function finished(outcome: Outcome) {
    panel.value = null
    report(outcome)
  }

  return { busy, finished, panel, press }
}
