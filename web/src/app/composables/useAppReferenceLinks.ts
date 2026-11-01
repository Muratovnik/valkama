import { computed, reactive } from 'vue'
import { useI18n } from 'vue-i18n'

import { fetchSessionContext } from '@/shared/api/api.ts'
import { searchGlobalPlanningWorkItems } from '@/shared/api/planningGlobalSearchApi.ts'
import type { PlanningTarget } from '@/shared/api/planningTarget.ts'
import type { PlatformContextReady } from '@/shared/api/platformApiTypes.ts'
import { planningSpaceRef } from '@/shared/api/platformPlanningRefs.ts'
import { provideReferenceLinks, referenceSpaceKey } from '@/shared/lib/referenceLinks.ts'

/**
 * The top layer of reference links: what the shell can answer from anywhere.
 *
 * - A work item reference is a link when its key names a space of a project
 *   this installation knows; `SHA-256` names none and stays text. Opening it
 *   asks the global search for that exact reference — the finder's own path —
 *   and opens what it finds, or says it found nothing. The open space answers
 *   for its own references below this layer, from the items it holds.
 * - A session id is a link once the server's session table knows it; it is
 *   asked once per id and remembered for as long as the app runs.
 */
export function useAppReferenceLinks(options: {
  openSession: (id: string) => void
  openTarget: (target: PlanningTarget) => void
  projects: () => readonly PlatformContextReady['projects'][number][]
  say: (message: string) => void
}) {
  const { t } = useI18n()
  /** Per session id the server answered for: whether it knows it. */
  const sessions = reactive(new Map<string, boolean>())
  /** Ids already asked about, so a render asks once and never writes what it reads. */
  const asked = new Set<string>()

  /** The keys of every planning space a known project maps. */
  const spaceKeys = computed(() => {
    const keys = new Set<string>()
    for (const project of options.projects())
      for (const resource of project.resources) {
        if (resource.state !== 'mapped') continue
        try {
          const space = planningSpaceRef(resource.resource_ref)
          if (space) keys.add(space.space_key)
        } catch {
          // A resource that is not a planning space names no key.
        }
      }
    return keys
  })

  function knownSession(id: string): boolean {
    if (!asked.has(id)) {
      asked.add(id)
      fetchSessionContext(id)
        .then((context) => sessions.set(id, context.resolved))
        .catch(() => sessions.set(id, false))
    }
    return sessions.get(id) === true
  }

  async function openReference(reference: string) {
    try {
      const found = await searchGlobalPlanningWorkItems(reference, new AbortController().signal)
      const entry = found.items.find((candidate) => candidate.item.reference === reference)
      if (entry) options.openTarget(entry.target)
      else options.say(t('textLinks.notFound', { reference }))
    } catch {
      options.say(t('textLinks.notFound', { reference }))
    }
  }

  provideReferenceLinks((reference) => {
    const { kind, value } = reference
    if (kind === 'work-item')
      return spaceKeys.value.has(referenceSpaceKey(value))
        ? {
            title: t('textLinks.openItem', { reference: value }),
            open: () => void openReference(value),
          }
        : null
    if (kind === 'session')
      return knownSession(value)
        ? { title: t('textLinks.openSession'), open: () => options.openSession(value) }
        : null
    return null
  })
}
