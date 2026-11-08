/**
 * The inspector's writes on one item, and what it says when one is refused.
 *
 * One place where every write lands, so a refusal is reported the same way
 * whichever section made it and the record is always re-read afterwards. A
 * guard refusal is an answer, not a crash: it names the guard that refused, in
 * the server's words, and the inspector offers the next action where it has
 * one. Overriding is offered only where the server accepts an override for
 * that exact refusal, and only runs after a second, explicit answer.
 */
import { ref } from 'vue'
import type { Ref } from 'vue'
import { useI18n } from 'vue-i18n'

import {
  attachWorkItemRef,
  claimWorkItem,
  planningRefusal,
  tickChecklistStep,
  transitionWorkItem,
  updateWorkItemFacts,
} from '@/shared/api/planningApi.ts'
import type { WorkItem } from '@/shared/api/planningModel.ts'
import { isWebAuthor } from '@/shared/api/webAuthor.ts'
import { holderName } from '@/shared/lib/actor.ts'

/** A move between states, by the key the server takes and the name a reader knows. */
export interface StateMove {
  key: string
  name: string
}

/** What the card's head changes in place: the state, by its key, the priority or the labels. */
export type FactChange = { state: string } | { priority: string } | { labels: string[] }

/** A refused write as the card shows it: what was refused, why, and any override on offer. */
export interface RefusalNotice {
  /** The server's reason, verbatim. */
  reason: string
  title: string
  /** What overriding would do, asked before it is done; absent when no override exists. */
  force?: { label: string; question: string }
  guards?: readonly string[]
  /** The move that was refused, for a guard whose answer carries it on. */
  move?: StateMove
}

/** How a write is named if it is refused, and how it is carried through if overriding is allowed. */
interface WriteContext {
  title: string
  /** An override the server accepts for exactly one refusal code. */
  force?: { label: string; overrides: string; question: string; run: () => Promise<unknown> }
  move?: StateMove
}

export function useInspectorWrites(options: {
  busy: Ref<boolean>
  item: Ref<WorkItem | null>
  /** Re-read the record and tell the page it changed. */
  changed: () => Promise<void>
  /** The sentence for a failure that is not a refusal: a dropped connection, a timeout. */
  failureText: (error: unknown) => string
  load: () => Promise<void>
  reference: () => string
  stateName: (stateKey: string) => string
  writable: () => boolean
}) {
  const { t } = useI18n()
  const { busy } = options
  const error = ref('')
  const notice = ref<RefusalNotice | null>(null)
  /** The override the refusal on screen offers, held until it is confirmed or dismissed. */
  let forced: (() => Promise<unknown>) | null = null

  async function write(operation: () => Promise<unknown>, context?: WriteContext) {
    if (!options.writable() || busy.value) return
    busy.value = true
    error.value = ''
    notice.value = null
    forced = null
    try {
      await operation()
      await options.changed()
    } catch (error_) {
      const refusal = planningRefusal(error_)
      // `unavailable` is a status with no answer behind it, not a refusal to explain.
      if (refusal === null || refusal.code === 'unavailable') {
        error.value = options.failureText(error_)
        return
      }
      // Re-read either way: whatever refused the write — a holder who arrived
      // first, a revision someone else wrote — is then what the head shows.
      void options.load()
      const override = context?.force?.overrides === refusal.code ? context.force : undefined
      notice.value = {
        title:
          refusal.code === 'revision_conflict'
            ? t('workItem.refusal.conflict')
            : (context?.title ?? t('workItem.refusal.generic')),
        reason: refusal.message,
        guards: refusal.guards,
        ...(context?.move ? { move: context.move } : {}),
        ...(override ? { force: { label: override.label, question: override.question } } : {}),
      }
      forced = override?.run ?? null
    } finally {
      busy.value = false
    }
  }

  function dismiss() {
    notice.value = null
    forced = null
  }

  function force() {
    const run = forced
    const title = notice.value?.title ?? t('workItem.refusal.generic')
    forced = null
    if (run) void write(run, { title })
  }

  function claim() {
    void write(() => claimWorkItem({ id: options.reference() }), {
      title: t('workItem.refusal.claim'),
    })
  }

  function release() {
    void write(() => claimWorkItem({ id: options.reference(), release: true }), {
      title: t('workItem.refusal.release'),
    })
  }

  /** Another holder's claim, taken with the override the server records as a takeover. */
  function takeOver() {
    void write(() => claimWorkItem({ id: options.reference(), force: true }), {
      title: t('workItem.refusal.takeover'),
    })
  }

  function moveTo(stateKey: string) {
    if (!stateKey) return
    const id = options.reference()
    const state = options.stateName(stateKey)
    void write(() => transitionWorkItem({ id, state: stateKey }), {
      title: t('workItem.refusal.transition', { state }),
      move: { key: stateKey, name: state },
      force: {
        label: t('workItem.refusal.force.transition'),
        overrides: 'workflow_guard',
        question: t('workItem.refusal.force.transitionQuestion', { state }),
        run: () => transitionWorkItem({ id, state: stateKey, force: true }),
      },
    })
  }

  function tick(itemId: string, done: boolean) {
    const id = options.reference()
    const holder = options.item.value?.checklist.find((entry) => entry.id === itemId)?.claimed_by
    const heldElsewhere = Boolean(holder) && !isWebAuthor(holder)
    void write(() => tickChecklistStep({ id, item_id: itemId, done }), {
      title: t('workItem.refusal.tick'),
      ...(heldElsewhere && done
        ? {
            force: {
              label: t('workItem.refusal.force.tick'),
              overrides: 'invalid_request',
              question: t('workItem.refusal.force.tickQuestion', {
                holder: holderName(holder ?? ''),
              }),
              run: () => tickChecklistStep({ id, item_id: itemId, done, force: true }),
            },
          }
        : {}),
    })
  }

  function changeFacts(change: FactChange) {
    if ('state' in change) moveTo(change.state)
    else if ('priority' in change) setPriority(change.priority)
    else setLabels(change.labels)
  }

  function setPriority(priority: string) {
    if (!priority || priority === options.item.value?.priority) return
    void write(() => updateWorkItemFacts({ id: options.reference(), priority }), {
      title: t('workItem.refusal.priority'),
    })
  }

  /**
   * The whole list, at the revision it was read at: a label attached or taken off elsewhere
   * meanwhile is a conflict the card re-reads, not a change this one silently undoes.
   */
  function setLabels(labels: readonly string[]) {
    const item = options.item.value
    if (!item) return
    void write(
      () =>
        updateWorkItemFacts({
          id: options.reference(),
          labels,
          expected_revision: item.revision,
        }),
      { title: t('workItem.refusal.labels') },
    )
  }

  /**
   * A pointer, not a copy. Valkama records that this item names the document;
   * the provider is not asked to store anything, which is why a read-only
   * knowledge source can still be attached to a work item.
   */
  function attachMemory(entry: { label: string; value: string }) {
    void write(
      () =>
        attachWorkItemRef({
          id: options.reference(),
          kind: 'memory',
          value: entry.value,
          label: entry.label,
        }),
      { title: t('workItem.refusal.attach') },
    )
  }

  return {
    attachMemory,
    changeFacts,
    claim,
    dismiss,
    error,
    force,
    notice,
    release,
    takeOver,
    tick,
  }
}
