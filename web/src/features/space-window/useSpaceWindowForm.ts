/**
 * The space window's reads, its draft and its one save.
 *
 * Opening reads the registered projects and the space's form together; a new space reads
 * only its workflow beside the projects. While a new space's key has not been typed, the
 * server's key for the name stands in it, read again as the name changes: the window keeps
 * no copy of how a key is derived.
 *
 * A save that the server refuses leaves the draft as typed and says why in the reader's
 * language. A save whose store part stood and whose registry part was refused (a creation,
 * a rename) leaves the window open on the space as it now is, saying so, and the next save
 * is that space's edit: «Retry binding» never creates a second space.
 */
import { computed, ref, shallowRef, watch } from 'vue'
import type { Ref } from 'vue'
import { useI18n } from 'vue-i18n'

import {
  draftGap,
  draftOf,
  emptyDraft,
  saveOf,
  SPACE_KEY_FORM,
} from '@/features/space-window/spaceDraft.ts'
import type { DraftOrigin, SpaceDraft } from '@/features/space-window/spaceDraft.ts'
import type { SpaceWindowTarget } from '@/features/space-window/spaceWindowHost.ts'

import type { PlanningSpaceRef } from '@/shared/api/platformPlanningRefs.ts'
import {
  fetchDerivedKey,
  fetchRegisteredProjects,
  fetchSpaceForm,
  saveSpace,
  spaceWindowRefusal,
} from '@/shared/api/spaceWindowApi.ts'
import type { RegisteredProject, SpaceForm, SpaceSaved } from '@/shared/api/spaceWindowApi.ts'

/** What a save did, for the shell to follow: the space it made, renamed the key of or removed. */
export interface SpaceWindowOutcome {
  /** The space as it was before the save; null for a creation. */
  before: PlanningSpaceRef | null
  saved: SpaceSaved
}

const KEY_PAUSE_MS = 250

export function useSpaceWindowForm(
  target: Readonly<Ref<SpaceWindowTarget | null>>,
  done: (outcome: SpaceWindowOutcome, closes: boolean) => void,
) {
  const i18n = useI18n()
  const { t } = i18n
  const te = (key: string) => i18n.te(key)

  const phase = ref<'reading' | 'failed' | 'ready'>('reading')
  const origin = shallowRef<DraftOrigin | null>(null)
  const draft = ref<SpaceDraft>(emptyDraft())
  const registered = shallowRef<RegisteredProject[]>([])
  const registryKnown = ref(true)
  const workflow = shallowRef<SpaceForm['workflow'] | null>(null)
  /** Why the server gives the name no key: a code of `spaceWindow.reasons`. */
  const keyRefusal = ref<string | null>(null)
  const saving = ref(false)
  /** Why the last save went nowhere, in the reader's words. */
  const error = ref('')
  /** What the last save did not do although the space stands: its registry part was refused. */
  const notice = ref('')
  let reading = 0

  /** A refusal's reason in the reader's language, or the server's own words for one unforeseen. */
  function reasonOf(failure: unknown): string {
    const refusal = spaceWindowRefusal(failure)
    const code = refusal?.reason ?? refusal?.code ?? 'request_failed'
    const key = `spaceWindow.reasons.${code}`
    return te(key) ? t(key) : (refusal?.message ?? t('spaceWindow.reasons.request_failed'))
  }

  async function read(next: SpaceWindowTarget) {
    const current = ++reading
    phase.value = 'reading'
    error.value = ''
    notice.value = ''
    keyRefusal.value = null
    const key = next.kind === 'edit' ? next.space.space_key : null
    try {
      const [projects, form] = await Promise.all([fetchRegisteredProjects(), fetchSpaceForm(key)])
      if (current !== reading) return
      const known = ['absent', 'available'].includes(projects.registry.status)
      registryKnown.value = known
      registered.value = known ? projects.projects : []
      workflow.value = form.workflow
      if (next.kind === 'edit' && form.space !== null) {
        const start = draftOf(next.space, form.space, registered.value)
        origin.value = start.origin
        draft.value = start.draft
      } else {
        origin.value = null
        draft.value = emptyDraft()
      }
      phase.value = 'ready'
    } catch {
      if (current === reading) phase.value = 'failed'
    }
  }

  watch(
    target,
    (next) => {
      reading += 1
      if (next !== null) void read(next)
    },
    { immediate: true },
  )

  // The server's key for a new space's name, while the reader has not typed one.
  let keyTimer: ReturnType<typeof setTimeout> | undefined
  let keyRead: AbortController | null = null
  watch([() => draft.value.name, () => draft.value.keyTyped, origin], ([name, typed, edited]) => {
    clearTimeout(keyTimer)
    keyRead?.abort()
    if (edited !== null || typed || phase.value !== 'ready') return
    if (!name.trim()) {
      draft.value.key = ''
      keyRefusal.value = null
      return
    }
    keyTimer = setTimeout(() => {
      const controller = new AbortController()
      keyRead = controller
      fetchDerivedKey(name.trim(), controller.signal)
        .then((answer) => {
          if (controller.signal.aborted || draft.value.keyTyped) return
          draft.value.key = answer.key ?? ''
          keyRefusal.value = answer.refusal?.code ?? null
        })
        .catch(() => {
          if (!controller.signal.aborted) keyRefusal.value = null
        })
    }, KEY_PAUSE_MS)
  })

  /** The reader typed the key: it is theirs from now on, unless they clear it. */
  function typeKey(value: string) {
    const key = value.toUpperCase().replaceAll(/\s+/gu, '')
    draft.value.key = key
    draft.value.keyTyped = key !== ''
    keyRefusal.value = null
  }

  /** Why the key cannot be sent as it stands, in the reader's words; empty when it can. */
  const keyError = computed(() => {
    if (keyRefusal.value !== null && !draft.value.keyTyped) {
      const key = `spaceWindow.reasons.${keyRefusal.value}`
      return te(key) ? t(key) : t('spaceWindow.keyForm')
    }
    const { key } = draft.value
    return key && !SPACE_KEY_FORM.test(key) ? t('spaceWindow.reasons.key_invalid') : ''
  })

  const gap = computed(() => draftGap(draft.value))

  async function send(save: Parameters<typeof saveSpace>[0], before: PlanningSpaceRef | null) {
    if (saving.value) return
    saving.value = true
    error.value = ''
    try {
      const saved = await saveSpace(save)
      const refused = saved.registry.status === 'refused'
      if (refused && saved.space_ref !== null) {
        notice.value = t(
          before === null ? 'spaceWindow.bindRefused' : 'spaceWindow.editBindRefused',
          {
            key: saved.space_ref.space_key,
            reason: registryReason(saved),
          },
        )
        origin.value = {
          ref: saved.space_ref,
          name: draft.value.name.trim(),
          key: saved.space_ref.space_key,
          keyLocked: origin.value?.keyLocked ?? false,
          workItems: origin.value?.workItems ?? 0,
          projects: origin.value?.projects ?? [],
          default: origin.value?.default ?? null,
        }
        draft.value.keyTyped = true
      } else notice.value = ''
      done({ saved, before }, !refused)
    } catch (error_) {
      error.value = t('spaceWindow.refused', { reason: reasonOf(error_) })
    } finally {
      saving.value = false
    }
  }

  /** The registry's reason for a refused part, in the reader's words where they have it. */
  function registryReason(saved: SpaceSaved): string {
    const key = `spaceWindow.reasons.${saved.registry.reason ?? 'request_failed'}`
    return te(key) ? t(key) : (saved.registry.message ?? t('spaceWindow.reasons.request_failed'))
  }

  function save() {
    if (gap.value !== null || keyError.value) return
    void send(saveOf(draft.value, origin.value), origin.value?.ref ?? null)
  }

  function remove() {
    const edited = origin.value
    if (edited === null || edited.workItems !== 0) return
    void send({ space: edited.ref, remove: true }, edited.ref)
  }

  function retry() {
    if (target.value !== null) void read(target.value)
  }

  return {
    draft,
    error,
    gap,
    keyError,
    notice,
    origin,
    phase,
    registered,
    registryKnown,
    remove,
    retry,
    save,
    saving,
    typeKey,
    workflow,
  }
}
