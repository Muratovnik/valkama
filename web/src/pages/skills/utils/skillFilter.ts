/**
 * Which skills a search and a state filter leave visible, in name order.
 *
 * The needle is matched against everything the record says about a skill rather
 * than its name alone: an operator looking for a skill they installed from a
 * particular root, or one whose validation named a check, has nothing else to
 * search by.
 */
import { readinessState } from '@/pages/skills/utils/skillPresentation.ts'

import type { SkillEntry } from '@/shared/types/skills.ts'

export function filterSkills(
  skills: SkillEntry[],
  query: string,
  status: string,
  locale: string,
): SkillEntry[] {
  const needle = query.trim().toLocaleLowerCase()
  return [...skills]
    .filter((skill) => {
      const state = readinessState(skill)
      if (
        status === 'enabled' &&
        !Object.values(skill.clients).some((client) => client.enabled === true)
      )
        return false
      if (status === 'disabled' && state !== 'disabled') return false
      if (status === 'issues' && !['invalid', 'unavailable'].includes(state)) return false
      if (!needle) return true
      return [
        skill.name,
        skill.description,
        skill.project_title,
        skill.owner_project_title,
        skill.location,
        skill.source,
        skill.root_id,
        skill.project_id,
        skill.owner_project_id,
        ...skill.validation.checks,
        ...Object.values(skill.metadata),
      ].some((value) =>
        String(value ?? '')
          .toLocaleLowerCase()
          .includes(needle),
      )
    })
    .sort((left, right) => left.name.localeCompare(right.name, locale))
}
