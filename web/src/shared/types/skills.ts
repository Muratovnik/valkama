/** The skills catalogue: roots, projects, entries and one skill's detail. */

type SkillScope = 'global' | 'project'
type SkillAvailability = 'available' | 'missing' | 'unreadable' | 'unsafe'
type SkillValidationStatus = 'valid' | 'invalid' | 'partial'
// The wire carries a free-form client id. The alias adds no checking and is
// not meant to: the name is what tells a reader which string this one is.
// eslint-disable-next-line sonarjs/redundant-type-aliases -- see above
export type SkillClient = string
type SkillClientStatus = 'enabled' | 'disabled' | 'unavailable' | 'unknown'

interface SkillClientDefinition {
  id: SkillClient
}

export interface SkillClientActivation {
  can_toggle: boolean
  enabled: boolean | null
  reason: string | null
  status: SkillClientStatus
}

export interface SkillRoot {
  availability: 'available' | 'missing' | 'unavailable' | 'unsafe' | 'partial'
  id: string
  manifest_source_hash: string | null
  project_id: string | null
  /** The project's display title from Host Runtime's schema-v3 registry. */
  project_title: string | null
  reason: string | null
  relative_root: '.agents/skills'
  scope: SkillScope
  skill_count: number
  source: 'user-canonical' | 'project-local'
  truncated: boolean
  validation: 'valid' | 'partial' | 'invalid'
}

export interface SkillProject {
  id: string
  project_title: string
  root_status: SkillRoot['availability']
  skill_count: number
}

/**
 * A skill's identity as an object rather than a path.
 *
 * A path is not an identity: the same skill projected into two roots has two of
 * them, and a path that moves takes every reference with it. The content hash
 * rides along because a reference to a skill whose file has changed is a
 * reference to a different skill.
 */
export interface SkillRef {
  content_hash: string | null
  provider_id: string
  root_id: string
  skill_id: string
}

export interface SkillEntry {
  availability: SkillAvailability
  capabilities: {
    asset_entries: number
    asset_entries_truncated: boolean
    assets: boolean
    reference_entries: number
    reference_entries_truncated: boolean
    references: boolean
    script_entries: number
    script_entries_truncated: boolean
    scripts: boolean
  }
  clients: Record<SkillClient, SkillClientActivation>
  description: string
  directory_name: string
  duplicate: boolean
  key: string
  location: string
  metadata: {
    compatibility: string | null
    license: string | null
    version: string | null
  }
  name: string
  owner_project_id: string | null
  owner_project_title: string | null
  project_id: string | null
  project_title: string | null
  provenance: {
    content_hash: string | null
    duplicate_of: string | null
    observed_at: string
    source: 'filesystem'
  }
  root_id: string
  scope: SkillScope
  skill_ref: SkillRef
  source: SkillRoot['source']
  validation: {
    checks: string[]
    code: string | null
    schema: 'agentskills-v1'
    status: SkillValidationStatus
  }
}

export interface SkillsPayload {
  as_of: string
  clients: SkillClientDefinition[]
  interface_version: 'skills'
  projects: SkillProject[]
  registry: {
    project_count: number
    reason: string | null
    source: 'host_runtime'
    status: 'absent' | 'available' | 'malformed' | 'unavailable'
    total_project_count: number
    truncated: boolean
  }
  roots: SkillRoot[]
  skills: SkillEntry[]
  summary: {
    duplicates: number
    invalid: number
    partial: number
    projects: number
    roots: number
    skills: number
    valid: number
  }
}

export interface SkillDetail {
  content_hash: string
  interface_version: 'skill-detail'
  key: string
  location: string
  markdown: string
  name: string
}
