import { inject, provide, ref } from 'vue'
import type { InjectionKey, Ref } from 'vue'

/** A project as the app names it: its id and the name a reader sees. */
type ProjectName = { display_name: string; project_id: string }

/**
 * A space as the app lists it: where it is, its key, and the name a reader sees, with the
 * projects the context bar offers in it, its own and those of other spaces its items name.
 */
export type SpaceName = {
  data_scope_id: string
  name: string
  space_key: string
  other_space_projects?: readonly ProjectName[]
  projects?: readonly ProjectName[]
}

const SPACE_NAMES: InjectionKey<Readonly<Ref<readonly SpaceName[]>>> = Symbol('space-names')

/**
 * The space list the app already loads, provided once at the root so that a
 * deep surface can name a space without a prop passed through every layer.
 */
export function provideSpaceNames(spaces: Readonly<Ref<readonly SpaceName[]>>) {
  provide(SPACE_NAMES, spaces)
}

/** The provided list inside a surface that has no provider: empty, so keys show. */
export function useSpaceNames(): Readonly<Ref<readonly SpaceName[]>> {
  return inject(SPACE_NAMES, () => ref<SpaceName[]>([]), true)
}

const listed = (
  spaces: readonly SpaceName[],
  space: { data_scope_id: string; space_key: string },
) =>
  spaces.find(
    (item) => item.data_scope_id === space.data_scope_id && item.space_key === space.space_key,
  )

/** The space's name from the list, or its key when the list does not hold it. */
export function spaceName(
  spaces: readonly SpaceName[],
  space: { data_scope_id: string; space_key: string },
): string {
  return listed(spaces, space)?.name ?? space.space_key
}

/**
 * A project's name as the context bar names it in that space, or its id when the space does
 * not offer it, as the bar names a project the space does not list.
 */
export function projectName(
  spaces: readonly SpaceName[],
  space: { data_scope_id: string; space_key: string },
  project: string,
): string {
  const found = listed(spaces, space)
  return (
    [...(found?.projects ?? []), ...(found?.other_space_projects ?? [])].find(
      (item) => item.project_id === project,
    )?.display_name ?? project
  )
}
