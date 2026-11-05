import { computed, reactive } from 'vue'
import { useI18n } from 'vue-i18n'

import type { PreviewCandidate } from '@/entities/work-item/composables/useWorkItemPreviewReads.ts'
import { useReadWorkItemPreview } from '@/entities/work-item/composables/useWorkItemReferencePreview.ts'

import { fetchSessionContext } from '@/shared/api/api.ts'
import { searchGlobalPlanningWorkItems } from '@/shared/api/planningGlobalSearchApi.ts'
import type { PlanningTarget } from '@/shared/api/planningTarget.ts'
import type { PlatformContextReady } from '@/shared/api/platformApiTypes.ts'
import { planningSpaceRef } from '@/shared/api/platformPlanningRefs.ts'
import { workItemLinkAddress } from '@/shared/api/platformRoute.ts'
import type { SayNotice } from '@/shared/lib/notice.ts'
import { provideReferenceLinks, referenceSpaceKey } from '@/shared/lib/referenceLinks.ts'

type Project = PlatformContextReady['projects'][number]

/** A resource's planning space, or nothing for one that is not mapped to a space. */
function mappedSpace(resource: Project['resources'][number]) {
  if (resource.state !== 'mapped') return null
  try {
    return planningSpaceRef(resource.resource_ref) ?? null
  } catch {
    return null
  }
}

/** Every planning space a known project maps, by its key, where a press looks first leading. */
function spacesByKey(projects: readonly Project[], primary: string | undefined) {
  const keys = new Map<string, PreviewCandidate[]>()
  for (const project of projects)
    for (const resource of project.resources) {
      const space = mappedSpace(resource)
      if (!space) continue
      const found = keys.get(space.space_key) ?? []
      const candidate = { project_id: project.project_id, space_ref: space }
      if (space.data_scope_id === primary) found.unshift(candidate)
      else found.push(candidate)
      keys.set(space.space_key, found)
    }
  return keys
}

/**
 * The top layer of reference links: what the shell can answer from anywhere.
 *
 * - A work item reference is a link when its key names a space of a project
 *   this installation knows; `SHA-256` names none and stays text. Opening it
 *   asks the global search for that exact reference — the finder's own path —
 *   and opens what it finds, or says it found nothing. Its address is the item's
 *   short one, `/open/<number>`, which the server leads to the same card by the
 *   same order of stores, for a press that goes elsewhere. The open space answers
 *   for its own references below this layer, from the items it holds. Resting
 *   on it reads the item from the spaces that key names, the primary store first
 *   because that is where a press would find it.
 * - A session id is a link once the server's session table knows it; it is
 *   asked once per id and remembered for as long as the app runs.
 * - A path means nothing without the space its text belongs to, so it is text
 *   here. The card and the question provide the layer that answers for one.
 */
export function useAppReferenceLinks(options: {
  say: SayNotice
  openSession: (id: string) => void
  openTarget: (target: PlanningTarget) => void
  /** The store whose space a press finds first when two stores hold one key. */
  primaryScope: () => string | undefined
  projects: () => readonly PlatformContextReady['projects'][number][]
}) {
  const { t } = useI18n()
  /** Per session id the server answered for: whether it knows it. */
  const sessions = reactive(new Map<string, boolean>())
  /** Ids already asked about, so a render asks once and never writes what it reads. */
  const asked = new Set<string>()

  const previewRead = useReadWorkItemPreview(
    (id) => options.projects().find((project) => project.project_id === id)?.title ?? null,
  )

  const spaces = computed(() => spacesByKey(options.projects(), options.primaryScope()))

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
      else options.say(t('textLinks.notFound', { reference }), 'refused')
    } catch {
      options.say(t('textLinks.notFound', { reference }), 'refused')
    }
  }

  provideReferenceLinks((reference) => {
    const { kind, value } = reference
    if (kind === 'work-item') {
      const candidates = spaces.value.get(referenceSpaceKey(value))
      return candidates
        ? {
            title: t('textLinks.openItem', { reference: value }),
            href: workItemLinkAddress('', value),
            open: () => void openReference(value),
            preview: previewRead(value, candidates),
          }
        : null
    }
    if (kind === 'session')
      return knownSession(value)
        ? { title: t('textLinks.openSession'), open: () => options.openSession(value) }
        : null
    return null
  })
}
