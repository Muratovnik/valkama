/**
 * What this screen calls the things the skills payload describes.
 *
 * The catalogue and the drawer say the same words about the same skill — a
 * readiness, the reason behind it, the client it belongs to — so the words live
 * here once instead of twice. `readinessState` stands outside the factory
 * because it needs no catalogue: it reads the record and returns a state, which
 * is what the filter needs too.
 */
import { SkillsContractError, SkillsRequestError } from '@/entities/skill/api/skillsApi'

import { typedFailure } from '@/shared/api/typedFailure.ts'
import type { TypedFailure } from '@/shared/api/typedFailure.ts'
import type { SkillClient, SkillClientActivation, SkillEntry } from '@/shared/types/skills.ts'
import type { ChoiceOption } from '@/shared/ui/choiceControls'

type Translate = (key: string, named?: Record<string, unknown>) => string
type HasMessage = (key: string) => boolean

/** How ready a skill is, from the record alone. */
export function readinessState(skill: SkillEntry) {
  if (skill.validation.status === 'invalid' || skill.availability !== 'available') return 'invalid'
  const clients = Object.values(skill.clients)
  const enabled = clients.filter((client) => client.enabled === true).length
  const configurable = clients.filter((client) => client.can_toggle).length
  if (!configurable) return 'unavailable'
  if (enabled === configurable && configurable === clients.length) return 'enabled'
  if (enabled > 0) return 'partial'
  return 'disabled'
}

/** The code a failed skills request reports, in narrowing order. */
function failureCode(error: unknown): string {
  if (error instanceof SkillsRequestError) return error.detail_code
  if (error instanceof SkillsContractError) return error.code
  return 'skills_request_failed'
}

/** The same, for the calls that publish one code rather than a detail. */
function requestCode(error: unknown): string {
  return error instanceof SkillsContractError || error instanceof SkillsRequestError
    ? error.code
    : 'skills_request_failed'
}

/** A presentation-safe failure whose code keeps the Skills boundary's exact cause. */
export function skillFailure(error: unknown, detail = false): TypedFailure {
  return {
    ...typedFailure(error, 'skills_request_failed'),
    code: detail ? failureCode(error) : requestCode(error),
  }
}

/** The states the catalogue filters by. */
export function statusOptions(translate: Translate): ChoiceOption[] {
  return [
    { value: 'all', label: translate('skills.filters.allStates') },
    { value: 'enabled', label: translate('skills.filters.enabled') },
    { value: 'disabled', label: translate('skills.filters.disabled') },
    { value: 'issues', label: translate('skills.filters.issues') },
  ]
}

/** The two distinct questions the Skills surface can answer. */
export function skillsViewOptions(translate: Translate) {
  return [
    { value: 'catalog' as const, label: translate('skills.inventory') },
    { value: 'matrix' as const, label: translate('skills.applicability') },
  ]
}

/** The labels, bound to a catalogue and a locale. */
export function skillPresentation(
  translate: Translate,
  hasMessage: HasMessage,
  currentLocale: () => string,
) {
  /** A code the catalogue has a phrase for, or the code itself. */
  function reasonLabel(code: string | null) {
    if (!code) return ''
    const key = `skills.reasons.${code}`
    return hasMessage(key) ? translate(key) : code
  }

  return {
    reasonLabel,

    sourceLabel(source: SkillEntry['source']) {
      return translate(`skills.sources.${source}`)
    },

    scopeLabel(skill: SkillEntry) {
      return skill.owner_project_title || skill.project_title || translate('skills.personal')
    },

    capabilityCount(skill: SkillEntry, kind: 'script' | 'reference' | 'asset') {
      const count = skill.capabilities[`${kind}_entries`]
      return skill.capabilities[`${kind}_entries_truncated`]
        ? `${count}+`
        : count || translate('skills.none')
    },

    readinessLabel(skill: SkillEntry) {
      return translate(`skills.readiness.${readinessState(skill)}`)
    },

    /** Why a skill is not simply ready, in one line, or nothing. */
    skillReason(skill: SkillEntry) {
      if (skill.validation.code) return reasonLabel(skill.validation.code)
      if (skill.availability !== 'available') return reasonLabel(`skill_${skill.availability}`)
      const state = readinessState(skill)
      if (state === 'unavailable') {
        return reasonLabel(
          Object.values(skill.clients).find((client) => client.reason)?.reason ||
            'activation_unavailable',
        )
      }
      if (state === 'partial') {
        return translate('skills.enabledCount', {
          enabled: Object.values(skill.clients).filter((client) => client.enabled === true).length,
          total: Object.values(skill.clients).length,
        })
      }
      return ''
    },

    clientLabel(client: SkillClient) {
      const key = `skills.clients.${client}`
      if (hasMessage(key)) return translate(key)
      return client
        .split('-')
        .map((part) => part.charAt(0).toLocaleUpperCase() + part.slice(1))
        .join(' ')
    },

    /** The two agent clients are named glyphs; anything else is a generic client. */
    clientIcon(client: SkillClient): string {
      const id = client.toLocaleLowerCase()
      if (id.startsWith('claude')) return 'claude'
      if (id.startsWith('codex')) return 'codex'
      return 'client'
    },

    clientStateLabel(state: SkillClientActivation) {
      return translate(`skills.clientStatus.${state.status}`)
    },

    formatObserved(value: string) {
      const parsed = new Date(value)
      return Number.isNaN(parsed.valueOf())
        ? value
        : new Intl.DateTimeFormat(currentLocale(), {
            dateStyle: 'medium',
            timeStyle: 'short',
          }).format(parsed)
    },
  }
}
