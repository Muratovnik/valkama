import { computed, onUnmounted, ref, watch } from 'vue'

import {
  ANSWER_VERSION_LIMIT,
  differsFromAnswer,
} from '@/features/input-requests/utils/answerChange.ts'
import { requestIdentity } from '@/features/input-requests/utils/requestIdentity.ts'
import { checkAnswers } from '@/features/input-requests/utils/validateAnswers.ts'
import type { RequestDraft } from '@/features/input-requests/utils/validateAnswers.ts'

import {
  answerInputRequest,
  changeInputRequestAnswer,
  declineInputRequest,
  fetchInputRequest,
  InputRequestError,
} from '@/shared/api/inputRequestApi.ts'
import type { InputRequestEntry } from '@/shared/api/inputRequestModel.ts'

const SUPPORTED_FIELDS = new Set(['boolean', 'choice', 'multi_choice', 'text', 'verdict'])

type Action = 'answer' | 'change' | 'decline'
type Checked = ReturnType<typeof checkAnswers>

function failure(error: unknown) {
  if (!(error instanceof InputRequestError)) return 'mutationError'
  if (error.reason === 'task_closed') return 'taskClosed'
  return error.status === 409 || error.status === 410 ? 'conflict' : 'mutationError'
}

/**
 * One question's own copy of how it stands, and the writes that change it.
 *
 * The copy goes forward only: a read that began before an answer confirmed here says
 * the question still waits, and it must not bring the fields back. A write's answer
 * that names another question is not an answer to this one. A write that failed leaves
 * the question as it was, because what is on the server is not known until it is read.
 *
 * Declining is the one write a person need put nothing into, and it cannot be taken back,
 * so asking for it the first time only asks in return (`declining`), and nothing else can
 * start it.
 *
 * An answered question can be changed while its task is open. The change is written against
 * the revision its form was opened on, not the copy here, which a poll may have moved on: an
 * answer that changed under the form is a conflict to read, not something to overwrite. A
 * write that went wrong stays on screen across those polls, for the same reason.
 */
export function useRequestWrites(host: {
  draft: () => RequestDraft
  entry: () => InputRequestEntry
  /** The reason now stands where it is read. */
  failed: () => Promise<void>
  /** The question's task is closed, so its answer stays as it is. */
  itemClosed: () => boolean
  /** The send stopped at this field. */
  refuse: (field: string) => Promise<void>
  /** A write confirmed, or a read asked for: `action` is null for the read. */
  settled: (result: InputRequestEntry, action: Action | null) => Promise<void> | void
}) {
  const local = ref(host.entry())
  const busy = ref(false)
  const error = ref<'' | 'conflict' | 'mutationError' | 'taskClosed'>('')
  /** The fields the last send refused, by id; each clears once it is edited. */
  const refused = ref<string[]>([])
  const requiresRefresh = ref(false)
  /** Declining was asked for once, and the next word on it decides. */
  const asked = ref(false)
  const now = ref(Date.now())
  let generation = 0
  const request = computed(() => local.value.request)
  /** A deadline is all that ever needs the time, and most questions have none. */
  const timer = setInterval(() => {
    if (request.value.expires_at && request.value.status === 'pending') now.value = Date.now()
  }, 1000)
  onUnmounted(() => {
    generation++
    clearInterval(timer)
  })
  function forget() {
    error.value = ''
    refused.value = []
    requiresRefresh.value = false
    asked.value = false
  }
  watch(host.entry, (entry) => {
    if (requestIdentity(entry) !== requestIdentity(local.value)) {
      generation++
      busy.value = false
      forget()
    } else if (entry.request.revision < request.value.revision) return
    if (entry.request.status !== 'pending' && !changing.value) forget()
    local.value = entry
  })
  const pastDue = computed(() => {
    const expires = request.value.expires_at
    return expires !== null && Date.parse(expires) <= now.value
  })
  const supported = computed(() =>
    request.value.fields.every((field) => SUPPORTED_FIELDS.has(field.type)),
  )
  const writable = computed(
    () =>
      host.entry().target.writable &&
      local.value.target.writable &&
      request.value.status === 'pending' &&
      !pastDue.value &&
      supported.value,
  )
  const changing = computed(
    () => request.value.status === 'answered' && host.draft().changing !== null,
  )
  /** Whether this answer can be changed from here, as far as the card can tell. */
  const changeable = computed(
    () =>
      host.entry().target.writable &&
      local.value.target.writable &&
      request.value.status === 'answered' &&
      supported.value &&
      !host.itemClosed() &&
      request.value.answer_version < ANSWER_VERSION_LIMIT,
  )
  /** Nothing to save while the form says what the answer already says. */
  const unchanged = computed(
    () => changing.value && !differsFromAnswer(request.value, host.draft()),
  )
  const declining = computed(() => asked.value && writable.value && !requiresRefresh.value)
  /**
   * Only a write the server refused or could not confirm, or a deadline that has passed
   * here, needs the request read again; a question that has closed has nothing left to read
   * unless its answer is being changed.
   */
  const canRefresh = computed(() =>
    request.value.status === 'pending'
      ? error.value !== '' || pastDue.value
      : changing.value && error.value !== '',
  )

  async function fail(code: 'conflict' | 'mutationError' | 'taskClosed', blocking: boolean) {
    error.value = code
    if (blocking) requiresRefresh.value = true
    await host.failed()
  }
  /** Takes back the first step of declining, unless the write is already out. */
  function stepBack() {
    if (!busy.value) asked.value = false
  }
  async function resolve(action: Action) {
    const open = action === 'change' ? changeable.value && !unchanged.value : writable.value
    if (busy.value || !open || requiresRefresh.value) return
    // A person need put nothing into a question to decline it, and it cannot be taken back,
    // so whatever brought this press here, the first one only asks.
    if (action === 'decline' && !asked.value) {
      asked.value = true
      return
    }
    const checked = action === 'decline' ? null : checkAnswers(request.value.fields, host.draft())
    refused.value = checked?.refused ?? []
    const first = refused.value[0]
    if (first !== undefined) {
      // Taken to the first field to fix, the reader hears its message with it.
      await host.refuse(first)
      return
    }
    asked.value = action === 'decline'
    await write(action, checked)
  }
  function send(action: Action, checked: Checked | null) {
    const entry = local.value
    if (!checked || action === 'decline') return declineInputRequest(entry)
    const { note, changing: base } = host.draft()
    const parts = { own: checked.own, field_notes: checked.fieldNotes }
    if (action === 'answer') return answerInputRequest(entry, checked.values, note, parts)
    const atBase = {
      ...entry,
      request: { ...entry.request, revision: base ?? entry.request.revision },
    }
    return changeInputRequestAnswer(atBase, checked.values, { ...parts, note })
  }
  async function write(action: Action, checked: Checked | null) {
    const identity = requestIdentity(local.value)
    const current = ++generation
    busy.value = true
    error.value = ''
    try {
      const result = await send(action, checked)
      if (current !== generation || identity !== requestIdentity(local.value)) return
      if (requestIdentity(result) !== identity) {
        await fail('mutationError', true)
        return
      }
      local.value = result
      await host.settled(result, action)
    } catch (error_) {
      if (current === generation) await fail(failure(error_), true)
    } finally {
      if (current === generation) {
        busy.value = false
        asked.value = false
      }
    }
  }
  async function refresh() {
    if (busy.value) return
    const entry = local.value
    const identity = requestIdentity(entry)
    const current = ++generation
    busy.value = true
    try {
      const result = await fetchInputRequest(entry.target, entry.request.request_id)
      if (current !== generation || identity !== requestIdentity(local.value)) return
      if (requestIdentity(result) !== identity) {
        await fail('mutationError', false)
        return
      }
      local.value = result
      error.value = ''
      requiresRefresh.value = false
      await host.settled(result, null)
    } catch {
      if (current === generation) await fail('mutationError', false)
    } finally {
      if (current === generation) busy.value = false
    }
  }
  return {
    busy,
    canRefresh,
    changeable,
    changing,
    declining,
    error,
    forget,
    local,
    pastDue,
    refresh,
    refused,
    request,
    requiresRefresh,
    resolve,
    stepBack,
    supported,
    unchanged,
    writable,
  }
}
