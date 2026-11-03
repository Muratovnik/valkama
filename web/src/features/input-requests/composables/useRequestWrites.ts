import { computed, onUnmounted, ref, watch } from 'vue'

import { requestIdentity } from '@/features/input-requests/utils/requestIdentity.ts'
import { checkAnswers } from '@/features/input-requests/utils/validateAnswers.ts'
import type { RequestDraft } from '@/features/input-requests/utils/validateAnswers.ts'

import {
  answerInputRequest,
  declineInputRequest,
  fetchInputRequest,
  InputRequestError,
} from '@/shared/api/inputRequestApi.ts'
import type { InputAnswers, InputRequestEntry } from '@/shared/api/inputRequestModel.ts'

const SUPPORTED_FIELDS = new Set(['boolean', 'choice', 'multi_choice', 'text'])

type Action = 'answer' | 'decline'

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
 */
export function useRequestWrites(host: {
  draft: () => RequestDraft
  entry: () => InputRequestEntry
  /** The reason now stands where it is read. */
  failed: () => Promise<void>
  /** The send stopped at this field. */
  refuse: (field: string) => Promise<void>
  /** A write confirmed, or a read asked for: `action` is null for the read. */
  settled: (result: InputRequestEntry, action: Action | null) => Promise<void> | void
}) {
  const local = ref(host.entry())
  const busy = ref(false)
  const error = ref<'' | 'conflict' | 'mutationError'>('')
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
    if (entry.request.status !== 'pending') forget()
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
  const declining = computed(() => asked.value && writable.value && !requiresRefresh.value)
  /**
   * Only a write the server refused or could not confirm, or a deadline that has passed
   * here, needs the request read again; a question that has closed has nothing left to read.
   */
  const canRefresh = computed(
    () => request.value.status === 'pending' && (error.value !== '' || pastDue.value),
  )

  async function fail(code: 'conflict' | 'mutationError', blocking: boolean) {
    error.value = code
    if (blocking) requiresRefresh.value = true
    await host.failed()
  }
  /** Takes back the first step of declining, unless the write is already out. */
  function stepBack() {
    if (!busy.value) asked.value = false
  }
  async function resolve(action: Action) {
    if (busy.value || !writable.value || requiresRefresh.value) return
    // A person need put nothing into a question to decline it, and it cannot be taken back,
    // so whatever brought this press here, the first one only asks.
    if (action === 'decline' && !asked.value) {
      asked.value = true
      return
    }
    const { answers, note } = host.draft()
    const checked =
      action === 'answer' ? checkAnswers(request.value.fields, answers, note) : undefined
    refused.value = checked?.refused ?? []
    const first = refused.value[0]
    if (first !== undefined) {
      // Taken to the first field to fix, the reader hears its message with it.
      await host.refuse(first)
      return
    }
    asked.value = action === 'decline'
    await write(action, checked?.values ?? {}, note)
  }
  async function write(action: Action, values: InputAnswers, note: string) {
    const entry = local.value
    const identity = requestIdentity(entry)
    const current = ++generation
    busy.value = true
    error.value = ''
    try {
      const result = await (action === 'answer'
        ? answerInputRequest(entry, values, note)
        : declineInputRequest(entry))
      if (current !== generation || identity !== requestIdentity(local.value)) return
      if (requestIdentity(result) !== identity) {
        await fail('mutationError', true)
        return
      }
      local.value = result
      await host.settled(result, action)
    } catch (error_) {
      const closed =
        error_ instanceof InputRequestError && (error_.status === 409 || error_.status === 410)
      if (current === generation) await fail(closed ? 'conflict' : 'mutationError', true)
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
    declining,
    error,
    local,
    pastDue,
    refresh,
    refused,
    request,
    requiresRefresh,
    resolve,
    stepBack,
    supported,
    writable,
  }
}
