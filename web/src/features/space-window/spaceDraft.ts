import type { PlanningSpaceRef } from '@/shared/api/platformPlanningRefs.ts'
import { sameSpace } from '@/shared/api/platformPlanningRefs.ts'
/**
 * What the space window holds while it is being filled in, and the save it sends.
 *
 * The draft is the window's own copy: the space's name and key, its projects in the order
 * they are listed and which of them is the default, and the projects it registers from a
 * folder. Nothing in it is written until «Create» or «Save», which sends the whole of it as
 * one save; a refused save leaves it as it was typed.
 *
 * The window says before it is saved what the server would refuse: the default project has
 * no remove while the space has others, and a project that is another space's default while
 * that space has others is offered with the reason it cannot move.
 */
import type {
  NewProject,
  RegisteredProject,
  SpaceEdit,
  SpaceForm,
} from '@/shared/api/spaceWindowApi.ts'
import { collatorOf } from '@/shared/lib/collator.ts'

export const SPACE_KEY_FORM = /^[A-Z][A-Z0-9]{1,7}$/u
const PROJECT_ID_FORM = /^[a-z][a-z0-9-]{0,159}$/u

/** One of the space's projects as the window lists it. */
export interface DraftProject {
  display_name: string
  /** Registered by this save, from a folder. */
  fresh: boolean
  project_id: string
  root: string
}

export interface SpaceDraft {
  default: string | null
  fresh: NewProject[]
  key: string
  /** The reader typed the key, so a new name no longer replaces it. */
  keyTyped: boolean
  name: string
  projects: DraftProject[]
}

/** The space the window edits, as it stood when the window read it; null for a new one. */
export interface DraftOrigin {
  default: string | null
  key: string
  keyLocked: boolean
  name: string
  projects: string[]
  ref: PlanningSpaceRef
  workItems: number
}

const listed = (project: RegisteredProject): DraftProject => ({
  project_id: project.project_id,
  display_name: project.display_name,
  root: project.root,
  fresh: false,
})

export function emptyDraft(): SpaceDraft {
  return { name: '', key: '', keyTyped: false, projects: [], default: null, fresh: [] }
}

/** The space as the registry and the store have it, and the draft that starts from it. */
export function draftOf(
  ref: PlanningSpaceRef,
  form: NonNullable<SpaceForm['space']>,
  registered: readonly RegisteredProject[],
): { draft: SpaceDraft; origin: DraftOrigin } {
  const members = registered.filter((project) => project.space && sameSpace(project.space, ref))
  const fallback = members.find((project) => project.default)?.project_id ?? null
  const origin: DraftOrigin = {
    ref,
    name: form.name,
    key: form.key,
    keyLocked: form.key_locked,
    workItems: form.work_items,
    projects: members.map((project) => project.project_id),
    default: fallback,
  }
  const draft: SpaceDraft = {
    name: form.name,
    key: form.key,
    keyTyped: true,
    projects: members.map((project) => listed(project)),
    default: fallback,
    fresh: [],
  }
  return { origin, draft }
}

/** The project joins the space; the first one it has becomes its default. */
export function withProject(draft: SpaceDraft, project: DraftProject): SpaceDraft {
  if (draft.projects.some((one) => one.project_id === project.project_id)) return draft
  return {
    ...draft,
    projects: [...draft.projects, project],
    default: draft.default ?? project.project_id,
  }
}

/** A folder's project, registered by the save, joins the space. */
export function withFreshProject(draft: SpaceDraft, project: NewProject): SpaceDraft {
  const joined = withProject(draft, {
    project_id: project.project_id,
    display_name: project.display_name,
    root: project.canonical_root,
    fresh: true,
  })
  return joined === draft ? draft : { ...joined, fresh: [...draft.fresh, project] }
}

/** Whether the project can leave the space: the default can only once it is alone. */
export function removable(draft: SpaceDraft, projectId: string): boolean {
  return projectId !== draft.default || draft.projects.length === 1
}

export function withoutProject(draft: SpaceDraft, projectId: string): SpaceDraft {
  if (!removable(draft, projectId)) return draft
  return {
    ...draft,
    projects: draft.projects.filter((one) => one.project_id !== projectId),
    default: draft.default === projectId ? null : draft.default,
    fresh: draft.fresh.filter((one) => one.project_id !== projectId),
  }
}

export function withDefault(draft: SpaceDraft, projectId: string): SpaceDraft {
  return draft.projects.some((one) => one.project_id === projectId)
    ? { ...draft, default: projectId }
    : draft
}

/** A project the list «Add project» offers, and what adding it means. */
export interface ProjectChoice {
  /** The space it leaves by joining this one; null for a project in no space. */
  from: PlanningSpaceRef | null
  /** It is the default of a space that keeps other projects, so it cannot leave it. */
  held: boolean
  project: RegisteredProject
}

/**
 * The registered projects that can be offered: those in no space first, then those of
 * other spaces, each by name in the order of the interface's language (`locale`). A project
 * the draft has is not offered; one the edited space had and the draft dropped is offered
 * again as in no space, since it has not left yet.
 */
export function projectChoices(
  draft: SpaceDraft,
  registered: readonly RegisteredProject[],
  own: PlanningSpaceRef | null,
  locale: string,
): ProjectChoice[] {
  const inDraft = new Set(draft.projects.map((one) => one.project_id))
  const others = (space: PlanningSpaceRef, id: string) =>
    registered.some(
      (one) => one.project_id !== id && one.space !== null && sameSpace(one.space, space),
    )
  const choices = registered
    .filter((project) => !inDraft.has(project.project_id))
    .map((project): ProjectChoice => {
      const from =
        project.space === null || (own !== null && sameSpace(project.space, own))
          ? null
          : project.space
      return {
        project,
        from,
        held: from !== null && project.default && others(from, project.project_id),
      }
    })
  const order = (choice: ProjectChoice) => (choice.from === null ? 0 : 1)
  const collator = collatorOf(locale)
  return choices.sort(
    (one, two) =>
      order(one) - order(two) ||
      collator.compare(one.project.display_name, two.project.display_name),
  )
}

/**
 * The choices as a search lists them: those whose name holds what was typed first, then those
 * only their note matches, such as their folder; each part keeps the order it was given in, so
 * the projects in no space still come first among the names. Listed in that order alone, a
 * search for a name found it last, behind every project whose folder held the same word.
 */
export function namesFirst(choices: readonly ProjectChoice[], query: string): ProjectChoice[] {
  const needle = query.trim().toLocaleLowerCase()
  if (!needle) return [...choices]
  const named = (choice: ProjectChoice) =>
    choice.project.display_name.toLocaleLowerCase().includes(needle) ? 0 : 1
  return [...choices].sort((one, two) => named(one) - named(two))
}

/**
 * The space's projects as its window lists them: by name in the order of the interface's
 * language (`locale`), whatever order they joined in.
 */
export function byName(projects: readonly DraftProject[], locale: string): DraftProject[] {
  const collator = collatorOf(locale)
  return [...projects].sort((one, two) => collator.compare(one.display_name, two.display_name))
}

/** Where a path ends once a closing separator is left off. */
const pathEnd = (root: string) => root.replace(/[\\/]+$/u, '').length

/** The folder's own name: the last part of its path, without a closing separator. */
export function folderNameOf(root: string): string {
  const path = root.trim()
  return path.slice(0, pathEnd(path)).split(/[\\/]/u).pop() ?? ''
}

/**
 * A folder's path in the two parts a row cuts it between: all but its last folder, which a row
 * too narrow for the whole path cuts at its end, and the last folder with the separator before
 * it, which stays whole while the row has room for it. Together they are the path as written;
 * one with no separator is its last folder alone.
 */
export function pathParts(root: string): { head: string; tail: string } {
  const end = pathEnd(root)
  const at = Math.max(root.lastIndexOf('/', end - 1), root.lastIndexOf('\\', end - 1))
  return at > 0 ? { head: root.slice(0, at), tail: root.slice(at) } : { head: '', tail: root }
}

/**
 * The id a folder's project is offered under: the folder's own name in the form a project
 * id takes, lower case with hyphens. Empty when the name leaves nothing that form takes.
 */
export function projectIdOf(root: string): string {
  const id = folderNameOf(root)
    .toLowerCase()
    .replaceAll(/[^a-z0-9-]+/gu, '-')
    .replace(/^[^a-z]+/u, '')
    .replaceAll(/-+/gu, '-')
    .replace(/-$/u, '')
    .slice(0, 160)
  return PROJECT_ID_FORM.test(id) ? id : ''
}

export const projectIdValid = (id: string) => PROJECT_ID_FORM.test(id)

/** What the draft lacks before it can be sent; null when it can be. */
export function draftGap(draft: SpaceDraft): 'name' | 'key' | null {
  if (!draft.name.trim()) return 'name'
  if (!SPACE_KEY_FORM.test(draft.key)) return 'key'
  return null
}

/** Whether saving the draft would change anything the edited space has. */
export function draftChanged(draft: SpaceDraft, origin: DraftOrigin): boolean {
  const ids = draft.projects.map((one) => one.project_id)
  return (
    draft.name.trim() !== origin.name ||
    draft.key !== origin.key ||
    draft.default !== origin.default ||
    ids.length !== origin.projects.length ||
    ids.some((id) => !origin.projects.includes(id))
  )
}

/** The save the draft sends: a creation, or an edit of the space it started from. */
export function saveOf(draft: SpaceDraft, origin: DraftOrigin | null): SpaceEdit {
  return {
    ...(origin === null ? {} : { space: origin.ref }),
    name: draft.name.trim(),
    key: draft.key,
    projects: draft.projects.map((one) => ({
      project_id: one.project_id,
      default: one.project_id === draft.default,
    })),
    new_projects: draft.fresh,
  }
}
